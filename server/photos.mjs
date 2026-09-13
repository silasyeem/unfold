import {PDFDocument, concatTransformationMatrix, drawObject, pushGraphicsState, popGraphicsState} from 'pdf-lib';

export const PHOTO_LIMITS=Object.freeze({pages:20,uploadBytes:32*1024*1024,fileBytes:12*1024*1024,pdfBytes:8*1024*1024,dimension:8000,pixels:16_000_000,totalPixels:64_000_000});
let active=0;
const json=(error,status)=>Response.json({error},{status,headers:{'Cache-Control':'no-store'}});
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const u16=(bytes,offset)=>bytes[offset]*256+bytes[offset+1];
const u32=(bytes,offset)=>new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(offset);
const ascii=(bytes,start,length)=>String.fromCharCode(...bytes.subarray(start,start+length));

function checkDimensions(width,height){
 if(!width||!height||width>PHOTO_LIMITS.dimension||height>PHOTO_LIMITS.dimension||width*height>PHOTO_LIMITS.pixels)throw fail('A photo is too large. Use images under 16 megapixels and 8,000 pixels per side.',413);
}
function exifOrientation(bytes,start,end){
 if(ascii(bytes,start,6)!=='Exif\0\0')return 1;
 const base=start+6;
 if(base+8>end)return 1;
 const order=ascii(bytes,base,2),little=order==='II';
 if(!little&&order!=='MM')return 1;
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(view.getUint16(base+2,little)!==42)return 1;
 const offset=base+view.getUint32(base+4,little);
 if(offset<base+8||offset+2>end)return 1;
 const count=view.getUint16(offset,little);
 if(count>512||offset+2+count*12>end)return 1;
 for(let i=0;i<count;i++){
  const entry=offset+2+i*12;
  if(view.getUint16(entry,little)===0x112&&view.getUint16(entry+2,little)===3&&view.getUint32(entry+4,little)===1){
   const value=view.getUint16(entry+8,little);return value>=1&&value<=8?value:1;
  }
 }
 return 1;
}

// Read dimensions before pdf-lib allocates decoded PNG buffers.
export function inspectPhoto(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length<12)throw fail('A photo is empty or damaged. Choose JPEG or PNG images.');
 if(bytes.length>PHOTO_LIMITS.fileBytes)throw fail('Each photo must be smaller than 12 MB.',413);
 if(bytes[0]===0xff&&bytes[1]===0xd8){
  let offset=2,width=0,height=0,orientation=1,hasScan=false;
  while(offset<bytes.length){
   if(bytes[offset++]!==0xff)throw fail('A JPEG photo has damaged headers.');
   while(bytes[offset]===0xff)offset++;
   const marker=bytes[offset++];
   if(marker===0xd9)break;
   if(offset+2>bytes.length)throw fail('A JPEG photo is incomplete.');
   const length=u16(bytes,offset),start=offset+2,end=offset+length;
   if(length<2||end>bytes.length)throw fail('A JPEG photo is incomplete.');
   if(marker===0xe1&&ascii(bytes,start,6)==='Exif\0\0')orientation=exifOrientation(bytes,start,end);
   if([0xc0,0xc1,0xc2].includes(marker)){
    if(width)throw fail('A JPEG photo has duplicate frame headers.');
    if(length<8||bytes[start]!==8||![1,3,4].includes(bytes[start+5]))throw fail('Use a standard 8-bit JPEG photo.');
    height=u16(bytes,start+1);width=u16(bytes,start+3);checkDimensions(width,height);
    if(length!==8+3*bytes[start+5])throw fail('A JPEG photo has damaged color data.');
   }
   if(marker===0xda){if(length<6)throw fail('A JPEG photo has damaged scan data.');hasScan=true;offset=end;break;}
   offset=end;
  }
  if(!width||!height||!hasScan||offset>=bytes.length-2||bytes.at(-2)!==0xff||bytes.at(-1)!==0xd9)throw fail('A JPEG photo is incomplete or unsupported.');
  return {kind:'jpeg',width,height,orientation};
 }
 const signature=[137,80,78,71,13,10,26,10];
 if(signature.every((value,i)=>bytes[i]===value)){
  if(bytes.length<45||u32(bytes,8)!==13||ascii(bytes,12,4)!=='IHDR')throw fail('A PNG photo has damaged headers.');
  const width=u32(bytes,16),height=u32(bytes,20),depth=bytes[24],color=bytes[25],channels={0:1,2:3,3:1,4:2,6:4}[color];checkDimensions(width,height);
  const validDepth={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
  if(!channels||!validDepth[color]?.includes(depth)||bytes[26]!==0||bytes[27]!==0||bytes[28]>1)throw fail('This PNG format is unsupported. Save it as JPEG and try again.');
  let offset=8,ended=false;const data=[];
  while(offset+12<=bytes.length){
   const length=u32(bytes,offset),type=ascii(bytes,offset+4,4),end=offset+12+length;
   if(end>bytes.length)throw fail('A PNG photo is incomplete.');
   if(type==='IHDR'&&offset!==8)throw fail('A PNG photo has duplicate image headers.');
   if(['acTL','fcTL','fdAT'].includes(type))throw fail('Choose a still PNG photo instead of an animated image.');
   if(type==='IDAT')data.push(bytes.subarray(offset+8,offset+8+length));
   if(type==='IEND'){if(length!==0||end!==bytes.length)throw fail('A PNG photo has invalid trailing data.');ended=true;break;}
   offset=end;
  }
  if(!ended||!data.length)throw fail('A PNG photo is incomplete.');
  const scanlineSize=w=>1+Math.ceil(w*channels*depth/8);
  let decodedLength=height*scanlineSize(width);
  if(bytes[28]===1){
   decodedLength=0;
   for(const [x,y,dx,dy] of [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]){
    const w=Math.max(0,Math.ceil((width-x)/dx)),h=Math.max(0,Math.ceil((height-y)/dy));
    if(w&&h)decodedLength+=h*scanlineSize(w);
   }
  }
  return {kind:'png',width,height,orientation:1,data,decodedLength};
 }
 throw fail('Choose JPEG or PNG photos. HEIC and other image formats need to be saved as JPEG first.',415);
}

async function validatePngData(photo,signal){
 const reader=new Blob(photo.data).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
 let size=0;
 try{
  while(true){if(signal?.aborted)throw fail('Photo preparation cancelled.',499);const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>photo.decodedLength)throw fail('A PNG photo contains more pixel data than its dimensions allow.');}
  if(size!==photo.decodedLength)throw fail('A PNG photo has incomplete pixel data.');
 }catch(error){await reader.cancel().catch(()=>{});throw error.status?error:fail('A PNG photo has damaged pixel data.');}
}

export function photoTransform(width,height,orientation=1,rotation=0){
 let orientedWidth=orientation>=5?height:width,orientedHeight=orientation>=5?width:height;
 const swap=rotation===90||rotation===270;
 const outWidth=swap?orientedHeight:orientedWidth,outHeight=swap?orientedWidth:orientedHeight,scale=720/Math.max(outWidth,outHeight);
 const point=(u,v)=>{
  const x=u*width,y=(1-v)*height;
  const transformed={1:[x,y],2:[width-x,y],3:[width-x,height-y],4:[x,height-y],5:[y,x],6:[height-y,x],7:[height-y,width-x],8:[y,width-x]}[orientation];
  let [a,b]=transformed;
  if(rotation===90)[a,b]=[orientedHeight-b,a];
  if(rotation===180)[a,b]=[orientedWidth-a,orientedHeight-b];
  if(rotation===270)[a,b]=[b,orientedWidth-a];
  return [a*scale,(outHeight-b)*scale];
 };
 const origin=point(0,0),x=point(1,0),y=point(0,1);
 return {size:[outWidth*scale,outHeight*scale],matrix:[x[0]-origin[0],x[1]-origin[1],y[0]-origin[0],y[1]-origin[1],...origin]};
}

export async function photosToPdf(photos,rotations,{signal}={}){
 if(!Array.isArray(photos)||!photos.length||photos.length>PHOTO_LIMITS.pages)throw fail('Choose between 1 and 20 manual photos.');
 if(!Array.isArray(rotations)||rotations.length!==photos.length||rotations.some(value=>![0,90,180,270].includes(value)))throw fail('Each photo needs a rotation of 0, 90, 180, or 270 degrees.');
 const inspected=photos.map(bytes=>inspectPhoto(bytes));
 if(inspected.reduce((total,p)=>total+p.width*p.height,0)>PHOTO_LIMITS.totalPixels)throw fail('These photos contain too many pixels. Use fewer pages or smaller images.',413);
 if(photos.reduce((total,p)=>total+p.length,0)>PHOTO_LIMITS.uploadBytes)throw fail('Manual photos must total less than 32 MB.',413);
 const pdf=await PDFDocument.create();pdf.setTitle('Manual photos');pdf.setCreator('Unfold');pdf.setProducer('Unfold photo intake');
 // Stable metadata keeps a repeated upload of the same ordered photos linkable.
 pdf.setCreationDate(new Date('2000-01-01T00:00:00Z'));pdf.setModificationDate(new Date('2000-01-01T00:00:00Z'));
 for(let i=0;i<photos.length;i++){
  if(signal?.aborted)throw fail('Photo preparation cancelled.',499);
  const info=inspected[i];if(info.kind==='png')await validatePngData(info,signal);
  let image;try{image=await (info.kind==='jpeg'?pdf.embedJpg(photos[i]):pdf.embedPng(photos[i]));}catch{throw fail(`Photo ${i+1} could not be read. Save it as JPEG and try again.`);}
  const transform=photoTransform(info.width,info.height,info.orientation,rotations[i]),page=pdf.addPage(transform.size);
  const name=page.node.newXObject('Photo',image.ref);
  page.pushOperators(pushGraphicsState(),concatTransformationMatrix(...transform.matrix),drawObject(name),popGraphicsState());
  await image.embed();
 }
 const bytes=await pdf.save();if(bytes.length>PHOTO_LIMITS.pdfBytes)throw fail('The prepared manual exceeds 8 MB. Use fewer photos or smaller JPEG images.',413);
 return bytes;
}

async function readMultipart(request){
 const reader=request.body?.getReader();if(!reader)throw fail('Choose manual photos to upload.');
 let size=0;const chunks=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>PHOTO_LIMITS.uploadBytes){await reader.cancel();throw fail('Manual photo uploads must be smaller than 32 MB.',413);}chunks.push(value);}}
 catch(error){throw error.status?error:fail('The photo upload was interrupted.');}
 try{return await new Response(new Blob(chunks),{headers:{'Content-Type':request.headers.get('content-type')}}).formData();}catch{throw fail('The photo upload could not be read. Please select the photos again.');}
}

export async function handlePhotos(request,_env={}){
 const url=new URL(request.url);
 if(url.pathname!=='/api/photos')return json('Not found',404);
 if(request.method!=='POST')return json('Use POST',405);
 if(request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return json('Origin not allowed',403);
 if(request.headers.get('x-unfold-convert')!=='1')return json('Missing conversion request header',400);
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data;'))return json('Upload JPEG or PNG photos as multipart form data.',415);
 if(Number(request.headers.get('content-length'))>PHOTO_LIMITS.uploadBytes)return json('Manual photo uploads must be smaller than 32 MB.',413);
 if(active>=2)return json('Two photo uploads are being prepared. Please try again shortly.',429);
 active++;
 try{
  const form=await readMultipart(request);
  if([...form.keys()].some(key=>!['photos','rotations'].includes(key)))throw fail('The photo upload contains unexpected fields.');
  const files=form.getAll('photos');if(files.some(file=>typeof file==='string'))throw fail('Choose JPEG or PNG files.');
  const rotationFields=form.getAll('rotations');if(rotationFields.length!==1||typeof rotationFields[0]!=='string'||rotationFields[0].length>256)throw fail('The photo page order could not be read.');
  let rotations;try{rotations=JSON.parse(rotationFields[0]);}catch{throw fail('The photo rotations could not be read.');}
  const bytes=await photosToPdf(await Promise.all(files.map(async file=>new Uint8Array(await file.arrayBuffer()))),rotations,{signal:request.signal});
  return new Response(bytes,{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="photos-manual.pdf"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Pdf-Pages':String(files.length)}});
 }catch(error){return json(error.status?error.message:'The photos could not be prepared. Please try another image.',error.status||400);}
 finally{active--;}
}
