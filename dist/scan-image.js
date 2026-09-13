// Decode locally, normalize orientation, and strip metadata before upload.
export async function prepareScanPhoto(file){
  if(!file||!file.size||file.size>20*1024*1024)throw new Error('Choose a photo smaller than 20 MB.');
  const heic=/\.(heic|heif)$/i.test(file.name)||['image/heic','image/heif'].includes(file.type);
  const bytes=new Uint8Array(await file.slice(0,12).arrayBuffer());
  const jpeg=bytes[0]===255&&bytes[1]===216,png=[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
  if(!heic&&!jpeg&&!png)throw new Error('Choose a JPEG, PNG, or HEIC photo.');
  let bitmap;
  try{bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});}
  catch{
    if(!heic)throw new Error('This photo could not be opened. Try another image.');
    try{const {isHeic,heicTo}=await import('./vendor/heic-to.js');if(!await isHeic(file))throw new Error('Invalid HEIC');bitmap=await heicTo({blob:file,type:'bitmap'});}
    catch{throw new Error('This HEIC could not be opened. Export it as JPEG and try again.');}
  }
  try{
    if(!bitmap.width||!bitmap.height||bitmap.width>12000||bitmap.height>12000||bitmap.width*bitmap.height>50_000_000)throw new Error('Choose a photo under 50 megapixels.');
    const scale=Math.min(1,2000/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
    const context=canvas.getContext('2d');if(!context)throw new Error('Photo preparation is unavailable in this browser.');context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.9));if(!blob||blob.size>8*1024*1024)throw new Error('The photo is too large to scan. Try a smaller image.');
    return new File([blob],'parts-photo.jpg',{type:'image/jpeg'});
  }finally{bitmap?.close();}
}
