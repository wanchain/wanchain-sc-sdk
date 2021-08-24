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

const chainDict = { WAN: "WAN", ETH: "ETH", BSC: "BSC", AVAX: "AVAX", MOONBEAM: "MOONBEAM", MATIC: "MATIC", ADA: "ADA", ARB: "ARB", OPM: "OPM"};

let chainId, privateKey, deployerAddress, web3, chainType;
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

  // check required 
  // wan mainnet and testnet, eth mainnet and testnet
  if (['mainnet', 'testnet'].indexOf(cfg.network) >= 0) {
    chainType = chainDict.WAN;
  } else if (['ethereum', 'rinkeby', 'ropsten', 'kovan'].indexOf(cfg.network) >= 0) {
    chainType = chainDict.ETH;
  } else if (['bscMainnet', 'bscTestnet'].indexOf(cfg.network) >= 0) {
    chainType = chainDict.BSC;
  } else if (['avalancheMainnet', 'avalancheTestnet'].indexOf(cfg.network) >= 0) {
    chainType = chainDict.AVAX;
  } else if (['moonbeamMainnet', 'moonbeamTestnet'].indexOf(cfg.network) >= 0) {
    chainType = chainDict.MOONBEAM;
  } else if (['maticMainnet', 'maticTestnet'].indexOf(cfg.network) >= 0) {
    chainType = chainDict.MATIC;
  } else if (['adaMainnet', 'adaTestnet'].indexOf(cfg.network) >= 0) {
      chainType = chainDict.ADA;
  }else if (['arbMainnet', 'arbTestnet'].indexOf(cfg.network) >= 0) {
      chainType = chainDict.ARB;
  }else if (['opmMainnet', 'opmTestnet'].indexOf(cfg.network) >= 0) {
      chainType = chainDict.OPM;
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
  } else if (cfg.network == "bscTestnet") {
    chainId = '0x61';
  } else if (cfg.network == "bscMainnet") {
    chainId = '0x38';
  } else if (cfg.network == "avalancheTestnet") {
    chainId = '0xa869';
  } else if (cfg.network == "avalancheMainnet") {
    chainId = '0xa86a';
  } else if (cfg.network == "moonbeamTestnet") {
    chainId = '0x507';
  } else if (cfg.network == "moonbeamMainnet") {
    chainId = '0x504';
  } else if (cfg.network == "maticTestnet") {
    chainId = '0x13881';
  } else if (cfg.network == "maticMainnet") {
    chainId = '0x89';
  } else if (cfg.network == "adaMainnet") {
    chainId = '0x67';
  } else if (cfg.network == "adaTestnet") {
    chainId = '0x67';
  }else if (cfg.network == "arbTestnet") {
    chainId = '0x66eeb';
  }else if(cfg.network == "arbMainnet"){
    chainId = '0x67'; // todo update
  }else if (cfg.network == "opmTestnet") {
    chainId = '0x45';
  }else if(cfg.network == "opmMainnet"){
    chainId = '0xa'; // todo update
  }else {
    throw new Error(`Not support ${cfg.network}`);
  }
  // chainId = (cfg.network == "mainnet") ? '0x01' : '0x03';
  privateKey = Buffer.from(cfg.privateKey, 'hex');
  deployerAddress = getAddressString(privateKey);
  console.log("\r\nStart deployment on %s...", cfg.network);

  // init web3
  if (cfg.nodeURL.indexOf('https:') == 0) {
    web3 = new Web3(cfg.nodeURL);
  } else if (cfg.nodeURL.indexOf('http:') == 0) {
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

          if (flatContent.indexOf('// SPDX-License-Identifier: MIT') !== -1) {
              console.log('***********===Jacob file use // SPDX-License-Identifier: MIT ********');
              flatContent = flatContent.replaceAll('// SPDX-License-Identifier: MIT', '');
              flatContent = '// SPDX-License-Identifier: MIT \n' + flatContent;
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
    let input = {
        language: 'Solidity',
        sources: {
            // 'test.sol': {
            //     content: 'contract C { function f() public { } }'
            // }
        },
        settings: {
            "evmVersion": "byzantium",
            outputSelection: {
                '*': {
                    '*': ['*']
                }
            }
        }
    };

    if (fileName) {
        if (fileName.substr(-4).toLowerCase() != '.sol') {
            throw new Error("invalid contract filename " + fileName);
        }
    } else {
        fileName = contractName + '.sol';
    }

    let key = fileName + ":" + contractName;
    input.sources[fileName] = {content: contracts[fileName].content};
    var output = JSON.parse(solc.compile(JSON.stringify(input)));
    let data = JSON.parse(JSON.stringify(output.contracts[fileName][contractName]));
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
    let contract = new web3.eth.Contract(data.abi, address);
    contract.address = contract._address;
    contract.abi = contract._jsonInterface;
    return contract;
  } else {
    throw new Error("failed to deploy contract " + name);
  }
}

const getDeployContractTxData = (data, args = []) => {

    let contract = new web3.eth.Contract(data.abi);
    let options = {data: '0x' + data.evm.bytecode.object};
    if (args && (Object.prototype.toString.call(args) == '[object Array]') && (args.length > 0)) {
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

  let value = web3.utils.toWei(options.value.toString(), 'ether');
  value = new web3.utils.BN(value);
  value = '0x' + value.toString(16);

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

  let tx
  if (chainType === chainDict.WAN) {
    rawTx.Txtype = 0x01;
    tx = new wanTx(rawTx);
  } else {
    tx = new ethTx(rawTx);
  }
  // console.log("tx", JSON.stringify(tx, null, 4));
  // let tx = new wanTx(rawTx);
  tx.sign(currPrivateKey);
  // console.log("signedTx: %O", tx);

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

    let contract = new web3.eth.Contract(data.abi, address);
    contract.address = address;
    contract.abi = contract._jsonInterface;
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
  getAddressString,
  config,
  compile,
  link,
  deploy,
  sendTx,
  deployed,
  at
}
