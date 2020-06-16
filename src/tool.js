const fs = require('fs');
const path = require('path');

const contractAddressFile = 'ContractAddress.json';
const contractLocationFile = 'ContractLocation.json';

const cmpAddress = (address1, address2) => {
  return (address1.toLowerCase() == address2.toLowerCase());
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
  let addressMap = loadData(path.join(dir, contractAddressFile));
  let exist = addressMap.get(name);
  addressMap.set(name, address);
  let p = path.join(dir, contractAddressFile);
  write2file(p, JSON.stringify([...addressMap]));
  return exist;
}

const getAddress = (dir, name) => {
  let addressMap = loadData(path.join(dir, contractAddressFile));
  let address = addressMap.get(name);
  if (address) {
    return address;
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
  console.log("   * Contract: %s <--> Library: %s (at address: %s)", contract, lib, getAddress(dir, lib));
  console.log("");
}

const showDeployInfo = (name, receipt, exist) => {
  console.log("");
  let action = exist? "Replacing" : "Deploying";
  let title = action + " '" + name + "'";
  console.log("   %s", title);
  console.log("   %s", new Array(title.length).join('-'));
  console.log("   > transaction hash:    %s", receipt.transactionHash);
  console.log("   > contract address:    %s", receipt.contractAddress);
  console.log("   > block number:        %d", receipt.blockNumber);
  console.log("   > creator:             %s", receipt.from);
  console.log("   > gas used:            %d", receipt.gasUsed);
  console.log("");
}

const showTxInfo = (receipt) => {
  console.log("");
  let title = "Sending transaction to contract";
  console.log("   %s", title);
  console.log("   %s", new Array(title.length).join('-'));
  console.log("   > transaction hash:    %s", receipt.transactionHash);
  console.log("   > contract address:    %s", receipt.to);
  console.log("   > block number:        %d", receipt.blockNumber);
  console.log("   > sender:              %s", receipt.from);
  console.log("   > gas used:            %d", receipt.gasUsed);
  console.log("   > status:              %s", receipt.status);
}

module.exports = {
  cmpAddress,
  mkdir,
  setAddress,
  getAddress,
  setLocation,
  getLocation,
  showCompileInfo,
  showLinkInfo,
  showDeployInfo,
  showTxInfo
}
