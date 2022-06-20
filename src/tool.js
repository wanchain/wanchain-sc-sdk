const fs = require('fs');
const path = require('path');
const TronWeb = require('tronweb');

const contractAddressFile = 'ContractAddress.json';
const contractLocationFile = 'ContractLocation.json';

function getTronAddrInfo(addr) {
  if (TronWeb.isAddress(addr)) {
    let hex = "", base58 = "";
    if ((addr.length === 42) && (addr.indexOf('41') === 0)) {
      hex = addr;
      base58 = TronWeb.address.fromHex(addr);
    } else {
      hex = tronWeb.address.toHex(addr);
      base58 = addr;
    }
    let evm = ('0x' + hex.slice(2)).toLocaleLowerCase();
    return {hex, base58, evm};
  } else {
    throw new Error("invalid address: " + addr);
  }
}

function mkdir(dirname) {
  if (fs.existsSync(dirname)) {
    return true;
  } else {
    if (mkdir(path.dirname(dirname))) {
      fs.mkdirSync(dirname);
      return true;
    }
  }
}

const write2file = (filePath, content) => {
  fs.writeFileSync(filePath, content, {flag: 'w', encoding: 'utf8', mode: '0666'})
}

const readFromFile = (filePath) => {
  return fs.readFileSync(filePath, 'utf8');
}

const loadData = (filePath) => {
  try {
    let data = readFromFile(filePath);
    return new Map(JSON.parse(data));
  } catch { // file not exist
    return new Map();
  }
}

const setAddress = (dir, name, address) => {
  let addrInfo = getTronAddrInfo(address);
  let addressMap = loadData(path.join(dir, contractAddressFile));
  let exist = addressMap.get(name);
  addressMap.set(name, {hex: addrInfo.hex, base58: addrInfo.base58});
  let p = path.join(dir, contractAddressFile);
  write2file(p, JSON.stringify([...addressMap]));
  return exist;
}

const getAddressInfo = (dir, name) => {
  let addressMap = loadData(path.join(dir, contractAddressFile));
  let addrInfo = addressMap.get(name);
  if (addrInfo) {
    return addrInfo;
  } else {
    throw new Error(name + " is not deployed");
  }
}

const setLocation = (dir, name, location) => {
  let fileNameMap = loadData(path.join(dir, contractLocationFile));
  fileNameMap.set(name, location);
  let p = path.join(dir, contractLocationFile);
  write2file(p, JSON.stringify([...fileNameMap]));
}

const getLocation = (dir, name) => {
  let fileNameMap = loadData(path.join(dir, contractLocationFile));
  let location = fileNameMap.get(name);
  if (location) {
    return location;
  } else {
    throw new Error(name + " is not found");
  }
}

const showCompileInfo = (filePath) => {
  console.log("");
  console.log("   Compiling '%s'", filePath);
  console.log("");
}

const showLinkInfo = (contract, lib, dir) => {
  console.log("");
  console.log("   Linking");
  console.log("   -------");
  console.log("   * Contract: %s <--> Library: %s (at address: %s)", contract, lib, getAddressInfo(dir, lib).hex);
  console.log("");
}

const showDeployInfo = (name, receipt, exist, sender) => {
  console.log("");
  let action = exist? "Replacing" : "Deploying";
  let title = action + " '" + name + "'";
  console.log("   %s", title);
  console.log("   %s", new Array(title.length).join('-'));
  console.log("   > transaction hash:    %s", receipt.txID);
  console.log("   > contract address:    %s", receipt.contract_address);
  console.log("   > block number:        %d", Number('0x' + receipt.raw_data.ref_block_bytes));
  console.log("   > creator:             %s", sender);
  console.log("   > fee_limit:           %d", receipt.raw_data.fee_limit);
  console.log("   > result:              %s", receipt.ret[0].contractRet);
  console.log("");
}

const showTxInfo = (receipt, sender) => {
  console.log("");
  let title = "Sending transaction to contract";
  console.log("   %s", title);
  console.log("   %s", new Array(title.length).join('-'));
  console.log("   > transaction hash:    %s", receipt.txID);
  console.log("   > contract address:    %s", receipt.raw_data.contract[0].parameter.value.contract_address);
  console.log("   > block number:        %d", Number('0x' + receipt.raw_data.ref_block_bytes));
  console.log("   > sender:              %s", sender);
  if (receipt.raw_data.fee_limit) {
    console.log("   > fee limit:           %d", receipt.raw_data.fee_limit);
  }
  console.log("   > result:              %s", receipt.ret[0].contractRet);
}

module.exports = {
  getTronAddrInfo,
  mkdir,
  setAddress,
  getAddressInfo,
  setLocation,
  getLocation,
  showCompileInfo,
  showLinkInfo,
  showDeployInfo,
  showTxInfo
}
