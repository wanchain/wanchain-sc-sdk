const os = require("os")
const fs = require('fs');
const path = require('path');
const solc = require('solc');
const linker = require('solc/linker');
const cfg = require('./config');
const tool = require('./tool');
const Web3 = require('web3');
const ethUtil = require('ethereumjs-util');
const ethTx = require('ethereumjs-tx');
const wanUtil = require('wanchain-util');
const flattener = require('truffle-flattener');
const wanTx = wanUtil.wanchainTx;

const chainDict = { WAN: "WAN", ETH: "ETH" };

let chainId, privateKey, deployerAddress, web3, chainType;
let contracts = new Map(); // Map(contractFileName => contractContent)
let compiled = new Map();  // Map(contractName => compiledData)

const config = async (userCfg) => {
  // update config
  Object.assign(cfg, userCfg);

  // check required 
  // wan mainnet and testnet, eth mainnet and testnet
  if (['mainnet', 'testnet'].indexOf(cfg.network) >= 0) {
    chainType = chainDict.WAN;
  } else if (['ethereum', 'rinkeby', 'ropsten', 'kovan'].indexOf(cfg.network) >= 0) {
    chainType = chainDict.ETH;
  } else {
    throw new Error("network can only be mainnet or testnet");
  }
  // if (['mainnet', 'testnet', 'ethereum', 'rinkeby'].indexOf(cfg.network) < 0) {
  //   throw new Error("network can only be mainnet or testnet");
  // }
  if (!cfg.nodeURL) {
    throw new Error("nodeURL is required");
  }
  if ((!cfg.privateKey) || cfg.privateKey.length != 64) {
    throw new Error("invalid private key");
  }
  if ((!cfg.contractDir) || (!fs.existsSync(cfg.contractDir))) {
    throw new Error("contract dir doesn't exist");
  }

  // init deployer
  await init();
}

const init = async () => {
  if (cfg.network == "mainnet" || cfg.network == "ethereum") {
    chainId = '0x01';
  } else if (cfg.network == "testnet" || cfg.network == "ropsten") {
    chainId = '0x03';
  } else if (cfg.network == "rinkeby") {
    chainId = '0x04';
  } else if (cfg.network == "kovan") {
    chainId = '0x2a';
  } else {
    throw new Error(`Not support ${cfg.network}`);
  }
  // chainId = (cfg.network == "mainnet") ? '0x01' : '0x03';
  privateKey = Buffer.from(cfg.privateKey, 'hex');
  deployerAddress = '0x' + ethUtil.privateToAddress(privateKey).toString('hex').toLowerCase();
  console.log("\r\nStart deployment on %s...", cfg.network);

  // init web3
  if (cfg.nodeURL.indexOf('http:') == 0) {
    web3 = new Web3(new Web3.providers.HttpProvider(cfg.nodeURL));
  } else if (cfg.nodeURL.indexOf('wss:') == 0) {
    web3 = new Web3(new Web3.providers.WebsocketProvider(cfg.nodeURL));
  } else {
    throw new Error("invalid protocol, can only be http or wss");
  }

  // init output data path
  cfg.outputDir = cfg.outputDir || path.join(os.homedir(), '.wanchain-deployer');
  tool.mkdir(cfg.outputDir);

  // load contract file
  await loadContract(cfg.contractDir);
}

String.prototype.replaceAll = function (FindText, RepText) {
  regExp = new RegExp(FindText, "g");
  return this.replace(regExp, RepText);
}

const loadContract = async (dir) => {
  let files = fs.readdirSync(dir);

  for (let i=0; i<files.length; i++) {
    let file = files[i];
    let p = path.join(dir, file);
    if (fs.statSync(p).isDirectory()) {
      await loadContract(p);
    } else {
      if (file.indexOf('.sol') > 0) {
        console.log(p);
        let flatContent;
        try {
          flatContent = await flattener([p]);
          console.log('flatten: ', file);
        } catch (err) {
          console.log('err', err);
        }

        if (flatContent.indexOf('pragma experimental ABIEncoderV2') !== -1) {
          console.log('******* file use pragma experimental ABIEncoderV2 ********');
          flatContent = flatContent.replaceAll('pragma experimental ABIEncoderV2', '// pragma experimental ABIEncoderV2');
          flatContent = 'pragma experimental ABIEncoderV2; \n' + flatContent;
        }
        
        contracts[path.basename(p)] = {
          path: p, 
          // content: fs.readFileSync(p, 'utf-8')
          content: flatContent
        };
      }
    }
  }
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

// const link = (contract, ...libs) => {
//   let data = compiled.get(contract);
//   if (!data) {
//     compile(contract);
//     data = compiled.get(contract);
//   }
//   let refs = linker.findLinkReferences(data.bytecode);
//   console.log('link', refs, data.bytecode.length);
//   data.bytecode = linker.linkBytecode(data.bytecode, getLibAddress(contract, refs, libs));
//   console.log('link after', data.bytecode.length);

// }

const link = (contract, ...libs) => {
  let data = compiled.get(contract);
  if (!data) {
    compile(contract);
    data = compiled.get(contract);
  }
  compile(libs[0], contract+'.sol');
  let refs = linker.findLinkReferences(data.bytecode);
  // console.log('link', refs, data.bytecode);
  data.bytecode = linker.linkBytecode(data.bytecode, getLibAddress(contract, refs, libs));
  // console.log('link after', data.bytecode.length);

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
  console.log('getLibAddress', result);
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

  // console.log("serializeTx: %O", rawTx);
  let rawTx = {
    chainId: chainId,
    to: contractAddr,
    nonce: await getNonce(deployerAddress),
    gasPrice: cfg.gasPrice,
    gasLimit: cfg.gasLimit,      
    value: value,
    data: data
  };

  let tx
  if (chainType === chainDict.ETH) {
    tx = new ethTx(rawTx);
  } else {
    rawTx.Txtype = 0x01;
    tx = new wanTx(rawTx);
  }
  // console.log("tx", JSON.stringify(tx, null, 4));
  // let tx = new wanTx(rawTx);
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

const at = (name, address) => {
  if (!address) {
    throw new Error(`invalid address ${address}`);
  }
  return deployed(name, address);
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
  deployed,
  at
}