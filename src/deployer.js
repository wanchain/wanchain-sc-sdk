const os = require("os")
const fs = require('fs');
const path = require('path');
const solc = require('solc');
const linker = require('solc/linker');
const cfg = require('./config');
const tool = require('./tool');
const Web3 = require('web3');
const Web31 = require('web3-1x');
const ethUtil = require('ethereumjs-util');
const ethTx = require('ethereumjs-tx');
const flattener = require('truffle-flattener');

const buildinChainId = {
  // wanchain
  mainnet: 888,
  testnet: 999,
  // ethereum
  ethereum: 1,
  ropsten: 3,
  rinkeby: 4,
  kovan: 42,
  goerli: 6284,
  // other
  bscMainnet: 56,
  bscTestnet: 97,
  avalancheMainnet: 43114,
  avalancheTestnet: 43113,
  moonbeamMainnet: 1285,
  moonbeamTestnet: 1287,
  maticMainnet: 137,
  maticTestnet: 80001,
  adaMainnet: 103,
  adaTestnet: 103,
  arbMainnet: 42161,
  arbTestnet: 421611,
  opmMainnet: 10,
  opmTestnet: 69,
  ftmMainnet: 250,
  ftmTestnet: 4002
}

let chainId, privateKey, deployerAddress, web3, web31;
let contracts = new Map(); // Map(contractFileName => contractContent)
let compiled = new Map();  // Map(contractName => compiledData)

function getAddressString(privateKey) {
  if (!Buffer.isBuffer(privateKey)) {
    privateKey = Buffer.from(privateKey, "hex")
  }
  return ethUtil.bufferToHex(ethUtil.privateToAddress(privateKey));
};

const config = async (userCfg) => {
  // update config
  Object.assign(cfg, userCfg);

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
  chainId = cfg.chainId || buildinChainId[cfg.network];
  if (!chainId) {
    throw new Error("unrecognized network " + cfg.network);
  }

  privateKey = Buffer.from(cfg.privateKey, 'hex');
  deployerAddress = getAddressString(privateKey);
  console.log("\r\nStart deployment on %s...", cfg.network);

  // init web3 0.x and web3 1.x instance
  let protocol = cfg.nodeURL.split(':')[0];
  if (['http', 'https'].includes(protocol)) {
    web3 = new Web3(new Web3.providers.HttpProvider(cfg.nodeURL));
    web31 = new Web31(new Web3.providers.HttpProvider(cfg.nodeURL));
  } else if (protocol === 'wss') {
    web3 = new Web3(new Web3.providers.WebsocketProvider(cfg.nodeURL));
    web31 = new Web31(new Web3.providers.WebsocketProvider(cfg.nodeURL));
  }

  // init output data path
  cfg.outputDir = cfg.outputDir || path.join(os.homedir(), '.wanchain-deployer', cfg.network);
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
        let flatContent;
        try {
          flatContent = await flattener([p]);
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

const link = (contract, ...libs) => {
  let data = compiled.get(contract);
  if (!data) {
    compile(contract);
    data = compiled.get(contract);
  }
  libs.map(lib => compile(lib, contract +'.sol')); // for duplicate name contracts
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
  if (receipt && (receipt.status == 1)) {
    let address = tool.native2evmAddress(chainId, receipt.contractAddress);
    let exist = tool.setAddress(cfg.outputDir, name, address);
    tool.showDeployInfo(name, receipt, exist);
    let contract = new web31.eth.Contract(JSON.parse(data.interface), address);
    contract.address = contract.address || contract._address; // compatible for web3 0.x and web3 1.x
    contract.abi = contract.abi || contract._jsonInterface; // compatible for web3 0.x and web3 1.x
    return contract;
  } else {
    throw new Error("failed to deploy contract " + name);
  }
}

const getDeployContractTxData = (data, args = []) => {
  let contract = new web31.eth.Contract(JSON.parse(data.interface));
  let options = {data: '0x' + data.bytecode};
  if (args && (Object.prototype.toString.call(args)=='[object Array]') && (args.length > 0)) {
    options.arguments = args;
  }
  return contract.deploy(options).encodeABI();
}

const sendTx = async (contractAddr, data, options) => {
  options = Object.assign({}, {value:0, privateKey: null}, options);
  // console.log("sendTx, options", options);

  if (0 != data.indexOf('0x')){
    data = '0x' + data;
  }

  let currPrivateKey;
  let currDeployerAddress;
  if (options.privateKey && options.privateKey.toLowerCase() !== cfg.privateKey.toLowerCase()) {
    currPrivateKey = Buffer.from(options.privateKey, 'hex');
    currDeployerAddress = getAddressString(options.privateKey);
    // currDeployerAddress = '0x' + ethUtil.privateToAddress(options.privateKey).toString('hex').toLowerCase();
  } else {
    currPrivateKey = privateKey;
    currDeployerAddress = deployerAddress;
  }

  let value = web31.utils.toWei(options.value.toString(), 'ether');
  value = '0x' + new web31.utils.BN(value).toString(16);

  let rawTx = {
    chainId: chainId,
    to: contractAddr,
    nonce: await getNonce(currDeployerAddress),
    gasPrice: cfg.gasPrice,
    gasLimit: cfg.gasLimit,
    value: value,
    data: data
  };
  // console.log("serializeTx: %O", rawTx);
  let tx = new ethTx(rawTx);
  // console.log("tx", JSON.stringify(tx, null, 4));
  tx.sign(currPrivateKey);
  // console.log("signedTx: %O", tx);

  try {
    let txHash = await getTxHash(tx);
    // console.log({txHash});
    let receipt = await waitTxReceipt(txHash);
    // console.log({receipt});
    if (contractAddr) {
      tool.showTxInfo(receipt);
    }
    return receipt;
  } catch(err) {
    console.error("sendTx to contract %s error: %O", contractAddr, err);
    return null;
  }
}

const getTxHash = (signedTx) => {
  // web3 0.x sendRawTransaction return Error: spawn ENAMETOOLONG
  return new Promise((resolve, reject) => {
    web31.eth.sendSignedTransaction('0x' + signedTx.serialize().toString('hex'))
    .once('transactionHash', txHash => resolve(txHash))
    .once('error', err => reject(err))
  });
}

const waitTxReceipt = (txHash, timedout = 300000) => {
  // web3 1.x getTransactionReceipt checksum address maybe failed for variant evm
  const handler = function(resolve, reject) {
    web3.eth.getTransactionReceipt(txHash, (error, receipt) => {
      if (error || !receipt) {
        timedout -= 2000;
        if (timedout > 0) {
          setTimeout(() => handler(resolve, reject), 2000);
        } else {
          return reject("failed to get tx receipt: " + txHash);
        }
      } else {
        return resolve(receipt);
      }
    });
  }
  return new Promise(handler);
}

const deployed = (name, address = null) => {
  // check address
  let exist = tool.getAddress(cfg.outputDir, name);
  if (address) {
    if (!exist) { // do not overwrite exist
      address = tool.native2evmAddress(chainId, address);
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
  let contract = new web31.eth.Contract(JSON.parse(data.interface), address);
  contract.address = address; // compatible for web3 0.x and web3 1.x
  contract.abi = contract.abi || contract._jsonInterface; // compatible for web3 0.x and web3 1.x
  return contract;
}

const at = (name, address) => {
  if (!address) {
    throw new Error("invalid address " + address);
  }
  return deployed(name, address);
}

const getNonce = async (address) => {
  address = tool.native2evmAddress(chainId, address);
  if ((chainId == 50) || (chainId == 51)) { // XDC, pending will return 0
    return web3.eth.getTransactionCount(address);
  } else {
    return web3.eth.getTransactionCount(address, 'pending');
  }
}

module.exports = {
  getAddressString,
  config,
  compile,
  link,
  deploy,
  sendTx,
  deployed,
  at
}
