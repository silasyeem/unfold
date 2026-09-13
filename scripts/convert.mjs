import {readFile,writeFile} from 'node:fs/promises';
import {basename} from 'node:path';
import {convertPdf} from '../engine/convert.mjs';
const [file,pages,out]=process.argv.slice(2);
if(!file||!pages||!out){console.error('Usage: npm run convert -- manual.pdf PAGE_COUNT output.json');process.exit(1);}
try{const result=await convertPdf(new Uint8Array(await readFile(file)),{apiKey:process.env.OPENAI_API_KEY,model:process.env.OPENAI_MODEL,pageCount:Number(pages),filename:basename(file),signal:AbortSignal.timeout(1200000),onStage:message=>console.log(message)});await writeFile(out,JSON.stringify(result,null,2));console.log(`Saved ${result.guide.parts.length} parts and ${result.guide.steps.length} steps to ${out}`);console.log(JSON.stringify(result.usage));}catch(error){console.error(error.message);process.exit(1);}
