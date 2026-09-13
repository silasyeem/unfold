import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {PDFDocument} from 'pdf-lib';
import {handlePhotos,inspectPhoto,photosToPdf,photoTransform,PHOTO_LIMITS} from '../server/photos.mjs';

function crc32(bytes){let value=0xffffffff;for(const byte of bytes){value^=byte;for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;}
function chunk(name,bytes){const type=Buffer.from(name),out=Buffer.alloc(bytes.length+12);out.writeUInt32BE(bytes.length);type.copy(out,4);bytes.copy(out,8);out.writeUInt32BE(crc32(Buffer.concat([type,bytes])),out.length-4);return out;}
function png(width=3,height=2,{pixelBytes,duplicateHeader=false}={}){
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 const data=pixelBytes||Buffer.alloc((width*3+1)*height,0);const parts=[Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header)];
 if(duplicateHeader)parts.push(chunk('IHDR',header));
 return new Uint8Array(Buffer.concat([...parts,chunk('IDAT',deflateSync(data)),chunk('IEND',Buffer.alloc(0))]));
}
const jpeg=()=>new Uint8Array(Buffer.from('/9j/4AAQSkZJRgABAQAAeQB5AAD/4QCARXhpZgAATU0AKgAAAAgABAEaAAUAAAABAAAAPgEbAAUAAAABAAAARgEoAAMAAAABAAIAAIdpAAQAAAABAAAATgAAAAAAAAB5AAAAAQAAAHkAAAABAAOgAQADAAAAAQABAACgAgAEAAAAAQAAAAOgAwAEAAAAAQAAAAIAAAAA/+0AOFBob3Rvc2hvcCAzLjAAOEJJTQQEAAAAAAAAOEJJTQQlAAAAAAAQ1B2M2Y8AsgTpgAmY7PhCfv/AABEIAAIAAwMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjQ1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj5OXm5+jp6vHy8/T19vf4+fr/xAAfAQADAQEBAQEBAQEBAAAAAAAAAQIDBAUGBwgJCgv/xAC1EQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2wBDAAICAgICAgMCAgMFAwMDBQYFBQUFBggGBgYGBggKCAgICAgICgoKCgoKCgoMDAwMDAwODg4ODg8PDw8PDw8PDw//2wBDAQICAgQEBAcEBAcQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/3QAEAAH/2gAMAwEAAhEDEQA/AP3xyRkDjk/zoyfWk7n6mig0R//Z','base64'));

test('photo headers reject malformed, oversized, duplicate and unsupported images before embedding',()=>{
 assert.deepEqual(inspectPhoto(jpeg()),{kind:'jpeg',width:3,height:2,orientation:1});
 assert.throws(()=>inspectPhoto(jpeg().subarray(0,50)),/incomplete/);
 assert.throws(()=>inspectPhoto(new TextEncoder().encode('not an image at all')),/JPEG or PNG/);
 const huge=png();new DataView(huge.buffer).setUint32(16,100_000);assert.throws(()=>inspectPhoto(huge),/too large/);
 assert.throws(()=>inspectPhoto(png(3,2,{duplicateHeader:true})),/duplicate/);
 assert.throws(()=>inspectPhoto(new Uint8Array(PHOTO_LIMITS.fileBytes+1)),/12 MB/);
});
test('multipart photo pages retain order and rotation in a real PDF, with a stable source hash',async()=>{
 const photos=[jpeg(),png(1,4)],rotations=[90,0];const first=await photosToPdf(photos,rotations),second=await photosToPdf(photos,rotations);
 assert.deepEqual(first,second);
 const pdf=await PDFDocument.load(first);assert.equal(pdf.getPageCount(),2);assert.deepEqual(pdf.getPages().map(page=>page.getSize()),[{width:480,height:720},{width:180,height:720}]);
 const reversed=await PDFDocument.load(await photosToPdf([...photos].reverse(),[0,0]));assert.deepEqual(reversed.getPages().map(page=>page.getSize()),[{width:180,height:720},{width:720,height:480}]);
 const form=new FormData();form.append('photos',new File([photos[0]],'page.jpg',{type:'image/jpeg'}));form.append('photos',new File([photos[1]],'page.png',{type:'image/png'}));form.append('rotations',JSON.stringify(rotations));
 const response=await handlePhotos(new Request('http://localhost/api/photos',{method:'POST',headers:{Origin:'http://localhost','X-Unfold-Convert':'1'},body:form}));
 assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/pdf');assert.equal(response.headers.get('x-pdf-pages'),'2');assert.equal((await PDFDocument.load(await response.arrayBuffer())).getPageCount(),2);
});
test('photo PDF conversion rejects mismatched rotations, too many pages and PNG inflate bombs',async()=>{
 await assert.rejects(()=>photosToPdf([png()],[45]),/rotation/);
 await assert.rejects(()=>photosToPdf([png()],[]),/rotation/);
 await assert.rejects(()=>photosToPdf(Array(21).fill(png()),Array(21).fill(0)),/1 and 20/);
 await assert.rejects(()=>photosToPdf([png(1,1,{pixelBytes:Buffer.alloc(100_000)})],[0]),/more pixel data/);
 await assert.rejects(()=>photosToPdf([png(3,2,{pixelBytes:Buffer.alloc(1)})],[0]),/incomplete pixel data/);
 await assert.rejects(()=>photosToPdf([png()],[0],{signal:AbortSignal.abort()}),/cancelled/);
});
test('EXIF orientation and clockwise rotation keep all image corners inside the page',()=>{
 for(let orientation=1;orientation<=8;orientation++)for(const rotation of [0,90,180,270]){
  const {size:[width,height],matrix:[a,b,c,d,e,f]}=photoTransform(300,200,orientation,rotation);
  const corners=[[0,0],[1,0],[0,1],[1,1]].map(([x,y])=>[a*x+c*y+e,b*x+d*y+f]);
  for(const [x,y] of corners){assert(x>=0&&x<=width);assert(y>=0&&y<=height);}
  assert.equal(Math.min(...corners.map(p=>p[0])),0);assert.equal(Math.max(...corners.map(p=>p[0])),width);
  assert.equal(Math.min(...corners.map(p=>p[1])),0);assert.equal(Math.max(...corners.map(p=>p[1])),height);
 }
 const exif=Buffer.from([0xff,0xe1,0,34,...Buffer.from('Exif\0\0'),0x49,0x49,42,0,8,0,0,0,1,0,0x12,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);
 // Place the orientation after existing metadata, before the frame header.
 const original=jpeg(),marker=original.findIndex((b,i)=>b===0xff&&original[i+1]===0xc0);
 const bytes=new Uint8Array(Buffer.concat([original.subarray(0,marker),exif,original.subarray(marker)]));assert.equal(inspectPhoto(bytes).orientation,6);
 const normal=photoTransform(300,200,1,0),turned=photoTransform(300,200,1,90);assert.deepEqual(normal.matrix,[720,0,0,480,0,0]);assert.deepEqual(turned.matrix,[0,-720,480,0,0,720]);
});
test('photo endpoint checks same-origin, custom header, type and streaming body limits',async()=>{
 const req=(headers,body='x')=>new Request('http://localhost/api/photos',{method:'POST',headers,body});
 assert.equal((await handlePhotos(req({Origin:'https://elsewhere.example'}))).status,403);
 assert.equal((await handlePhotos(req({}))).status,400);
 assert.equal((await handlePhotos(req({'X-Unfold-Convert':'1','Content-Type':'image/jpeg'}))).status,415);
 assert.equal((await handlePhotos(req({'X-Unfold-Convert':'1','Content-Type':'multipart/form-data; boundary=x','Content-Length':String(PHOTO_LIMITS.uploadBytes+1)}))).status,413);
 const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(PHOTO_LIMITS.uploadBytes));controller.enqueue(new Uint8Array(1));controller.close();}});
 const streamed=new Request('http://localhost/api/photos',{method:'POST',headers:{'X-Unfold-Convert':'1','Content-Type':'multipart/form-data; boundary=x'},body:stream,duplex:'half'});
 assert.equal((await handlePhotos(streamed)).status,413);
});

test('photo dialog orders, rotates, removes and submits the displayed pages, then releases previews',async()=>{
 const {document,window}=parseHTML('<div id="mount"></div>');const create=document.createElement.bind(document);let open=false,counter=0,pdfReady,posted;const revoked=[];
 document.createElement=tag=>{const element=create(tag);if(tag==='dialog'){element.showModal=()=>{open=true;};element.close=()=>{open=false;};}return element;};
 const source=(await readFile(new URL('../dist/photo-intake.js',import.meta.url),'utf8')).replace('export function mountPhotoIntake','function mountPhotoIntake').replace('const file=await preparePhoto(files[i]);','const file=files[i];');
 const context={document,crypto,File,Blob,FormData,AbortController,URL:{createObjectURL:()=>`blob:photo-${++counter}`,revokeObjectURL:url=>revoked.push(url)},fetch:async(url,options)=>{assert.equal(url,'/api/photos');posted=options.body;return new Response(await photosToPdf([png()],[0]),{headers:{'Content-Type':'application/pdf'}});}};
 vm.runInNewContext(source+';globalThis.mount=mountPhotoIntake;',context);
 const errors=[],busy=[];const mounted=context.mount(document.querySelector('#mount'),{onPdfReady:async file=>{pdfReady=file;},onError:error=>errors.push(error),onBusy:value=>busy.push(value)});
 document.querySelector('.photo-launcher').click();assert.equal(open,true);
 const input=document.querySelector('input');input.files=[new File([jpeg()],'one.jpg',{type:'image/jpeg'}),new File([jpeg()],'two.jpg',{type:'image/jpeg'}),new File([jpeg()],'three.jpg',{type:'image/jpeg'})];input.dispatchEvent(new window.Event('change'));
 await new Promise(resolve=>setTimeout(resolve,10));
 document.querySelector('[aria-label="Move page 3 earlier"]').click();
 document.querySelector('[aria-label="Rotate page 1 clockwise"]').click();
 document.querySelector('[aria-label="Remove page 3"]').click();
 assert.deepEqual([...document.querySelectorAll('.photo-name')].map(el=>el.textContent),['one.jpg','three.jpg']);
 document.querySelector('.photo-footer .primary').click();await new Promise(resolve=>setTimeout(resolve,30));
 assert.deepEqual(posted.getAll('photos').map(file=>file.name),['one.jpg','three.jpg']);assert.equal(posted.get('rotations'),'[90,0]');assert.equal(pdfReady.name,'photos-manual.pdf');assert.equal(open,false);assert.equal(document.querySelector('.photo-download').hidden,false);assert.equal(errors.length,0);assert.deepEqual(busy,[true,false,true,false]);
 mounted.setDisabled(true);assert.equal(document.querySelector('.photo-launcher').disabled,true);mounted.destroy();assert.equal(document.querySelector('.photo-dialog'),null);assert.equal(revoked.length,4);
});
