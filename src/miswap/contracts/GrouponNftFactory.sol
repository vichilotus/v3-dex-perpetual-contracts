// SPDX-License-Identifier: MIT

import "./GrouponNft.sol";

pragma solidity ^0.8.4;

// A bare-minimum proof-of-concept
contract GrouponFactory {

  // VARIABLES & DATA STRUCTURES
  address[] public nftAddresses; // an array of all NFTs created through this factory

  mapping (address => mapping (uint256 => address)) issuers; // issuer => array of NFT contract addresses
  mapping (address => uint256) nftCounter; // the amount of NFT contracts that an issuer has created

  // READ METHODS
  function getNftAddressByIndex(uint256 _index) public view returns (address) {
    return nftAddresses[_index];
  }

  function getNftAddressesArray() public view returns (address[] memory) {
    return nftAddresses;
  }

  function getNftAddressesLength() public view returns (uint256) {
    return nftAddresses.length;
  }

  function nftOfIssuerByIndex(address _issuerAddress, uint256 index) public view returns (address) {
    require(index < nftCounter[_issuerAddress], "NFTs by issuer: issuer index out of bounds");
    return issuers[_issuerAddress][index];
  }

  function getNftsByIssuer(address _issuerAddress) public view returns (address[] memory) {
    uint256 nftCount = nftCounter[_issuerAddress];

    address[] memory issuerNfts = new address[](nftCount);

    for (uint256 i = 0; i < nftCount; i++) {
        issuerNfts[i] = nftOfIssuerByIndex(_issuerAddress, i);
    }

    return issuerNfts;
  }

  // WRITE METHODS
  function createGrouponNft(
    string memory _name, 
    string memory _symbol, 
    string memory _description, 
    string memory _image, 
    uint256 _maxSupply,
    uint256 _price
  ) public returns (address) {

    // create a new ERC-721 contract
    GrouponNft nft = new GrouponNft(_name, _symbol, _description, _image, _maxSupply, _price, msg.sender);

    // store the address into the NFT addresses array
    nftAddresses.push(address(nft));

    // map the NFT address with the issuer's address
    uint256 nftCount = nftCounter[msg.sender];
    issuers[msg.sender][nftCount] = address(nft);

    // increase the NFT counter for the issuer
    nftCounter[msg.sender] += 1;

    return address(nft);
  }
}