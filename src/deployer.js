const os = require("os")
const fs = require('fs');
const path = require('path');
const linker = require('solc/linker');
const util = require('util');
const cfg = require('./config');
const tool = require('./tool');
const TronWeb = require('tronweb');

let privateKey, tronWeb;
let contracts = new Map(); // Map(contractFileName => contractContent)
let compiled = new Map();  // Map(contractName => compiledData)

const config = async (userCfg) => {
  // update config
  Object.assign(cfg, userCfg);

  // check required 
  if (!cfg.fullNode) {
    throw new Error("fullNode is required");
  }
  if (!cfg.solidityNode) {
    throw new Error("solidityNode is required");
  }
  if (!cfg.eventServer) {
    throw new Error("eventServer is required");
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
  // init tronWeb
  tronWeb = new TronWeb(cfg.fullNode, cfg.solidityNode, cfg.eventServer, cfg.privateKey);
  // console.log({tronWeb});
  privateKey = cfg.privateKey;
  console.log("\r\nstart deploy on %s...", cfg.fullNode);

  // init output data path
  let outputDir = cfg.outputDir || path.join(os.homedir(), '.tron-deployer');
  if (cfg.network) {
    outputDir = path.join(outputDir, cfg.network);
  }
  cfg.outputDir = outputDir;
  tool.mkdir(cfg.outputDir);

  // load contract file
  loadContract(cfg.contractDir);
}

const loadContract = (dir) => {
  let files = fs.readdirSync(dir);
  for (let i = 0; i < files.length; i++) {
    let file = files[i];
    let p = path.join(dir, file);
    if (fs.statSync(p).isDirectory()) {
      loadContract(p);
    } else {
      if (file.indexOf('.json') > 0) {
        let o = require(p);
        if (o.bytecode !== '0x') {
          contracts[path.basename(o.sourcePath)] = {
            contractName: o.contractName,
            sourcePath: o.sourcePath,
            abi: o.abi,
            bytecode: o.bytecode
          };
        }
      }
    }
  }
}

// fileName is needed if it is not consistent with contractName
const compile = (contractName, fileName = null) => {
  if (fileName) {
    if (fileName.substr(-4).toLowerCase() != '.sol') {
      throw new Error("invalid contract filename " + fileName);
    }
  } else {
    fileName = contractName + '.sol';
  }
  let data = contracts[fileName];
  if (data && (data.contractName === contractName)) {
    let result = {abi: data.abi, bytecode: data.bytecode};
    compiled.set(contractName, result);
    let location = fileName + ":" + contractName;
    tool.setLocation(cfg.outputDir, contractName, location);
    tool.showCompileInfo(data.sourcePath);
    return result;
  } else {
    throw new Error(util.format("failed to compile %s@%s", contractName, fileName));
  }
}

const link = (contract, ...libs) => {
  let data = compiled.get(contract);
  if (!data) {
    data = compile(contract);
  }
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
          let addrInfo = tool.getAddressInfo(cfg.outputDir, lib);
          result[ref] = tool.getTronAddrInfo(addrInfo.hex).evm;
          tool.showLinkInfo(contract, lib, cfg.outputDir);
        }
      })      
    }
  }
  return result;
}

// compile and link can be skipped for simple and canonical contract
const deploy = async (name, ...paras) => {
  let data = compiled.get(name);
  if (!data) {
    data = compile(name);
  }
  const options = {
    feeLimit: 10000000000,
    callValue: 0,
    userFeePercentage: 100,
    originEnergyLimit: 10000000,
    abi: data.abi,
    bytecode: data.bytecode,
    funcABIV2: data.abi.find(v => (v.type === "constructor") || ((v.type === "function") && (v.name === name))),
    parametersV2: paras,
    name
  };
  // console.log("deploy options: %O, deployer address: %O", options, tronWeb.defaultAddress.hex);
  let tx = await tronWeb.transactionBuilder.createSmartContract(options, tronWeb.defaultAddress.hex);
  let signedTx = await tronWeb.trx.sign(tx, privateKey);
  let result = await tronWeb.trx.sendRawTransaction(signedTx);
  if (result) {
    let receipt = await waitTxReceipt(result.transaction.txID);
    // console.log("deploy receipt: %O", receipt);
    if (receipt.ret[0].contractRet === "SUCCESS") {
      let exist = tool.setAddress(cfg.outputDir, name, receipt.contract_address);
      tool.showDeployInfo(name, receipt, exist, tronWeb.defaultAddress.hex);
      return;
    } else {
      tool.showDeployInfo(name, receipt, false, tronWeb.defaultAddress.hex);
    }
  }
  throw new Error("failed to deploy contract " + name);
}

const sendTx = async (tx, options = {}) => {
  tronWeb.setPrivateKey(options.privateKey || privateKey);
  let txOptions = {
    feeLimit: options.feeLimit || 10000000000,
    callValue: options.callValue || 0,
    shouldPollResponse: false // true always return [], why?
  };
  let txHash = await tx.send(txOptions);
  let receipt = await waitTxReceipt(txHash);
  tool.showTxInfo(receipt, tronWeb.defaultAddress.hex);
  if (receipt.ret[0].contractRet !== "SUCCESS") {
    throw new Error("sendTx to contract error");
  }
}

const waitTxReceipt = (txHash, timedout = 180000) => {
  const handler = function(resolve, reject) {
    tronWeb.trx.getConfirmedTransaction(txHash, (error, receipt) => {
      // console.log("tx %s receipt: %O", txHash, receipt)
      if (error || (!receipt) || (!receipt.ret) || (!receipt.ret[0].contractRet)) {
        timedout -= 2000;
        if (timedout > 0) {
          setTimeout(() => handler(resolve, reject), 2000);
        } else {
          return reject("failed to get tx receipt: " + txHash);
        }
      } else {
        // console.log("waitTxReceipt: %O", receipt);
        return resolve(receipt);
      }
    });
  }
  return new Promise(handler);
}

const deployed = async (name, address = null) => {
  let exist = null;
  try {
    exist = tool.getAddressInfo(cfg.outputDir, name);
  } catch (e) {
    console.log(name + " is not deployed");
  }
  let data = compiled.get(name);
  if (address) {
    // do not retrive contract from chain, because tronweb do not support parse tuple type input para from abi
    let contract = await tronWeb.contract(data.abi, address);
    if (!exist) {
      tool.setAddress(cfg.outputDir, name, address);
    }
    return contract;
  } else if (exist) {
    let contract = await tronWeb.contract(data.abi, exist.hex);
    contract.address = exist.hex;
    contract.deployed = true;
    return contract;
  } else {
    throw new Error(name + " is not deployed");
  }
}

const at = (name, address) => {
  if (!address) {
    throw new Error(`invalid address ${address}`);
  }
  return deployed(name, address);
}

const getTronAddrInfo = (address) => {
  return tool.getTronAddrInfo(address);
}

const updateSetting = async (contractAddress, userPercent, ownerAddress) => {
  let tx = await tronWeb.transactionBuilder.updateSetting(contractAddress, userPercent, ownerAddress);
  let signedTx = await tronWeb.trx.sign(tx, privateKey);
  let result = await tronWeb.trx.sendRawTransaction(signedTx);
  if (result) {
    let receipt = await waitTxReceipt(result.transaction.txID);
    // console.log("updateSetting receipt: %O", receipt);
    tool.showTxInfo(receipt, tronWeb.defaultAddress.hex);
    if (receipt.ret[0].contractRet === "SUCCESS") {
      return;
    }
  }
  throw new Error("failed to updateSetting contract " + contractAddress);
}

module.exports = {
  config,
  compile,
  link,
  deploy,
  sendTx,
  waitTxReceipt,
  deployed,
  at,
  getTronAddrInfo,
  updateSetting
}
