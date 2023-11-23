// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "base64-sol/base64.sol";

contract GrouponNft is ERC721, Ownable, ERC721Enumerable, ERC721Burnable {
    using Counters for Counters.Counter;

    Counters.Counter private _tokenIdTracker;
    uint256 public maxSupply;
    uint256 public price;
    string public description;
    string public image;

    enum NftStatus {
        Minted,
        Claimed,
        Completed
    }

    struct SingleNftData {
        uint256 tokenId;
        NftStatus status; // minted, claimed, completed
        address lastHolder; // only write for claimed and completed
        // bool disputed;
        // bool paymentUnlocked;
        // uint256 expirationDate; // if it's not set on the contract level
    }

    // mapping (uint256 => SingleNftData) public allNfts; // tokenId => SingleNftData
    SingleNftData[] public allNfts;

    // EVENTS
    event Claim(address indexed owner, uint256 indexed tokenId); // token owner & token ID
    event Completed(uint256 indexed tokenId);

    // CONSTRUCTOR
    constructor(
        string memory _name,
        string memory _symbol,
        string memory _description,
        string memory _image,
        uint256 _maxSupply,
        uint256 _price,
        address _issuer
    ) ERC721(_name, _symbol) {
        require(_maxSupply > 0, "Owner cannot deploy zero supply tokens");
        description = _description;
        image = _image;
        maxSupply = _maxSupply;
        price = _price;
        transferOwnership(_issuer);
    }

    // READ METHODS
    function fetchAllNfts() public view returns (SingleNftData[] memory) {
        return allNfts;
    }

    function fetchNftsByHolder(address _holder) external view returns (uint256[] memory) {
        uint256 nftCount = balanceOf(_holder);

        uint256[] memory nftIds = new uint256[](nftCount);

        for (uint256 i = 0; i < nftCount; i++) {
            nftIds[i] = tokenOfOwnerByIndex(_holder, i);
        }

        return nftIds;
    }

    function hasBeenClaimed(uint256 _tokenId) public view returns (bool) {
        if (_tokenId >= totalMinted()) {
            return false;
        }

        if (allNfts[_tokenId].status == NftStatus.Claimed) {
            return true;
        }

        return false;
    }

    function hasBeenCompleted(uint256 _tokenId) public view returns (bool) {
        if (_tokenId >= totalMinted()) {
            return false;
        }

        if (allNfts[_tokenId].status == NftStatus.Completed) {
            return true;
        }

        return false;
    }

    function tokenURI(uint256) public view override returns (string memory) {
        return
            string(
                abi.encodePacked(
                    "data:application/json;base64,",
                    Base64.encode(
                        bytes(
                            abi.encodePacked('{"name":"', name(), '", ', '"description": "', description, '", ', '"image": "', image, '"}')
                        )
                    )
                )
            );
    }

    function totalMinted() public view returns (uint256) {
        return _tokenIdTracker.current();
    }

    // WRITE METHODS

    function mint(address _to) public payable {
        uint256 idTracker = _tokenIdTracker.current();

        require(idTracker < maxSupply, "Mint limit");
        require(msg.value >= price, "Value below price");

        SingleNftData memory newNft;

        newNft.tokenId = idTracker;
        newNft.status = NftStatus.Minted;

        allNfts.push(newNft);

        _tokenIdTracker.increment();
        _safeMint(_to, idTracker);
    }

    // Claim means that the NFT holder requests a service/product from the issuer by burning the NFT
    function claim(uint256 _tokenId) public {
        address tokenOwner = ownerOf(_tokenId);

        burn(_tokenId); // this function checks if msg.sender has rights to burn this token

        allNfts[_tokenId].status = NftStatus.Claimed;
        allNfts[_tokenId].lastHolder = tokenOwner;

        emit Claim(tokenOwner, _tokenId);
    }

    // OWNER METHODS

    // After the service/product has been provided, issuer can mark the claim as completed
    function markCompleted(uint256 _tokenId) public onlyOwner {
        require(!_exists(_tokenId), "The NFT has not been claimed/burned yet.");
        require(hasBeenClaimed(_tokenId) == true, "The NFT has either been completed already or has not been minted yet.");

        allNfts[_tokenId].status = NftStatus.Completed;

        emit Completed(_tokenId);
    }

    function withdraw() public payable onlyOwner {
        withdrawTo(msg.sender);
    }

    function withdrawTo(address _address) public payable onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0);

        (bool success, ) = _address.call{value: balance}("");
        require(success, "Transfer failed.");
    }

    // OTHER
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId,
        uint256 batchSize
    ) internal virtual override(ERC721, ERC721Enumerable) {
        super._beforeTokenTransfer(from, to, tokenId, batchSize);
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC721, ERC721Enumerable) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
