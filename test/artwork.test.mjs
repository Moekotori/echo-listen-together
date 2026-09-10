import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readArtwork, updateArtwork} from '../src/artwork.mjs';
function cover(width=96,size=30){const b=Buffer.alloc(size);b.write('RIFF');b.write('WEBPVP8 ',8);b.set([0x9d,1,0x2a],23);b.writeUInt16LE(width,26);b.writeUInt16LE(96,28);return b.toString('base64');}
test('bounds cover type, bytes and dimensions',()=>{
 assert.equal(readArtwork(cover()),cover());assert.equal(readArtwork(null),null);
 for(const value of ['https://example.com/cover.jpg',cover(97),cover(96,4097),'AAAA',cover().replace(/=$/,'')+'!'])assert.throws(()=>readArtwork(value),/invalid_cover/);
});
test('keeps one current cover, shares bounded lyrics and ignores unknown data, deduplicates and bounds update rate',()=>{
 const room={streamEpoch:5};let calls=0;const broadcast=()=>calls++;
 const input={epoch:5,track:{title:'Song',cover:cover(),lyrics:{lines:[{text:'private'}]},filePath:'private'}};
 assert.throws(()=>updateArtwork(room,{...input,epoch:4},broadcast),/stream_changed/);
 updateArtwork(room,input,broadcast,0);assert.equal(calls,1);assert.equal(room.track.lyrics.lines[0].text,'private');assert.equal(room.track.filePath,undefined);
 updateArtwork(room,input,broadcast,1);assert.equal(calls,1);
 assert.throws(()=>updateArtwork(room,{epoch:5,track:{title:'Next'}},broadcast,100),/metadata_rate_limit/);
 updateArtwork(room,{epoch:5,track:{title:'Next'}},broadcast,500);assert.equal(room.track.cover,null);assert.equal(calls,2);
});
