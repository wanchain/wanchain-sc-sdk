const os = require("os")
const fs = require('fs');
const path = require('path');
const solc = require('solc');
const linker = require('solc/linker');
const cfg = require('./config');
const tool = require('./tool');
const Web3 = require('web3');
const wanUtil = require('wanchain-util');
const Tx = wanUtil.wanchainTx;
const ethUtil = require('ethereumjs-util');

let chainId, privateKey, deployerAddress, web3;
let contracts = new Map(); // Map(contractFileName => contractContent)
let compiled = new Map();  // Map(contractName => compiledData)

const config = (userCfg) => {
  // update config
  Object.assign(cfg, userCfg);

  // check required 
  if (['mainnet', 'testnet'].indexOf(cfg.network) < 0) {
    throw new Error("network can only be mainnet or testnet");
  }
  if (!cfg.wanNodeURL) {
    throw new Error("wanNodeURL is required");
  }
  if ((!cfg.privateKey) || cfg.privateKey.length != 64) {
    throw new Error("invalid private key");
  }
  if ((!cfg.contractDir) || (!fs.existsSync(cfg.contractDir))) {
    throw new Error("contract dir doesn't exist");
  }

  // init deployer
  init();
}

const init = () => {
  chainId = (cfg.network == "mainnet") ? '0x01' : '0x03';
  privateKey = Buffer.from(cfg.privateKey, 'hex');
  deployerAddress = '0x' + ethUtil.privateToAddress(privateKey).toString('hex').toLowerCase();
  console.log("\r\nStart deployment on %s...", cfg.network);

  // init web3
  if (cfg.wanNodeURL.indexOf('http:') == 0) {
    web3 = new Web3(new Web3.providers.HttpProvider(cfg.wanNodeURL));
  } else if (cfg.wanNodeURL.indexOf('wss:') == 0) {
    web3 = new Web3(new Web3.providers.WebsocketProvider(cfg.wanNodeURL));
  } else {
    throw new Error("invalid protocol, can only be http or wss");
  }

  // init output data path
  cfg.outputDir = cfg.outputDir || path.join(os.homedir(), '.wanchain-deployer');
  tool.mkdir(cfg.outputDir);

  // load contract file
  loadContract(cfg.contractDir);
}

const loadContract = (dir) => {
  let files = fs.readdirSync(dir);
  files.forEach(function(file) {
    let p = path.join(dir, file);
    if (fs.statSync(p).isDirectory()) {
      loadContract(p);
    } else {
      if (file.indexOf('.sol') > 0) {
        contracts[path.basename(p)] = {path: p, content: fs.readFileSync(p, 'utf-8')};
      }
    }
  });
}

// fileName is needed if it is not consistent with contractName
const compile = (contractName, fileName = null) => {
  let input = {};
  if (fileName) {
    if (fileName.substr(-4).toLowerCase() != '.sol') {
      throw new Error("invalid contract filename " + fileName);
    }
  } else {
    fileName = contractName + '.sol';
  }

  let key = fileName + ":" + contractName;
  input[fileName] = contracts[fileName].content;
  tool.showCompileInfo(contracts[fileName].path);
  let output = solc.compile({sources: input}, 1, getImport);
  let data = output.contracts[key];
  if (data) {
    compiled.set(contractName, data);
    tool.setLocation(cfg.outputDir, contractName, key);
    return data;
  } else {
    throw new Error("failed to compile contract " + contractName);
  }
}

function getImport(filePath) {
  let fileName = path.basename(filePath);
  let content = contracts[fileName].content;
  if (content) {
    return {contents: content};
  } else {
    return {error: fileName + ' not found'};
  }
}

const link = (contract, ...libs) => {
  let data = compiled.get(contract);
  let refs = linker.findLinkReferences(data.bytecode);
  data.bytecode = linker.linkBytecode(data.bytecode, getLibAddress(contract, refs, libs));
}

function getLibAddress(contract, refs, libs) {
  /* IMPORTANT !!!
     this function just do a rough judgment, it should be optimized if neccessary.
     libs is library name, refs contains relative path, and has max 36 chars.
     make sure library has short name and relative path.
  */
  // console.log("getLibAddress refs: %O", refs);
  // console.log("getLibAddress libs: %O", libs);
  let result = {};
  if (libs && libs.length > 0) {
    for (var ref in refs) {
      let refPath = path.basename(ref);
      libs.forEach(lib => {
        let libPath = tool.getLocation(cfg.outputDir, lib);
        if (libPath.indexOf(refPath) == 0) {
          result[ref] = tool.getAddress(cfg.outputDir, lib);
          tool.showLinkInfo(contract, lib, cfg.outputDir);
        }
      })      
    }
  }
  return result;
}

// compile and link can be skipped for simple and canonical contract
const deploy = async (name, ...args) => {
  let data = compiled.get(name);
  if (!data) {
    data = compile(name);
  }
  let txData = getDeployContractTxData(data, args);
  let receipt = await sendTx('', txData);
  if (receipt && receipt.status) {
    let address = receipt.contractAddress;
    let exist = tool.setAddress(cfg.outputDir, name, address);
    tool.showDeployInfo(name, receipt, exist);
    let contract = new web3.eth.Contract(JSON.parse(data.interface), address);
    contract.address = contract._address;
    return contract;
  } else {
    throw new Error("failed to deploy contract " + name);
  }
}

const getDeployContractTxData = (data, args = []) => {
  let contract = new web3.eth.Contract(JSON.parse(data.interface));
  let options = {data: '0x' + data.bytecode};
  if (args && (Object.prototype.toString.call(args)=='[object Array]') && (args.length > 0)) {
    options.arguments = args;
  }
  return contract.deploy(options).encodeABI();
}

const sendTx = async (contractAddr, data, wanValue = 0) => {
  if (0 != data.indexOf('0x')){
    data = '0x' + data;
  }

  let value = web3.utils.toWei(wanValue.toString(), 'ether');
  value = new web3.utils.BN(value);
  value = '0x' + value.toString(16);

  let rawTx = {
      chainId: chainId,
      Txtype: 0x01,
      to: contractAddr,
      nonce: await getNonce(deployerAddress),
      gasPrice: cfg.gasPrice,
      gasLimit: cfg.gasLimit,      
      value: value,
      data: data
  };
  // console.log("serializeTx: %O", rawTx);
  let tx = new Tx(rawTx);
  tx.sign(privateKey);

  try {
    let receipt = await web3.eth.sendSignedTransaction('0x' + tx.serialize().toString('hex'));
    if (contractAddr) {
      tool.showTxInfo(receipt);
    }
    return receipt;
  } catch(err) {
    console.error("sendTx to contract %s error: %O", contractAddr, err);
    return null;
  }  
}

const deployed = (name, address = null) => {
  // check address
  let exist = tool.getAddress(cfg.outputDir, name);
  if (address) {
    if (!exist) { // do not overwrite exist
      tool.setAddress(cfg.outputDir, name, address);
    }
  } else {
    if (exist) {
      address = exist;
    } else {
      throw new Error(name + " is not deployed");
    }
  }
  // check path
  let data = compile(name);
  let contract = new web3.eth.Contract(JSON.parse(data.interface), address);
  contract.address = address;
  return contract;
}

const getNonce = async (address) => {
  return await web3.eth.getTransactionCount(address, 'pending');
}

module.exports = {
  config,
  compile,
  link,
  deploy,
  sendTx,
  deployed
}