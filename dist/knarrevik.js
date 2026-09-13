export const KNARREVIK = Object.freeze({
  id: 'knarrevik-80576319', name: 'KNARREVIK', article: '805.763.19', size: '37 × 28 × 45 cm',
  productUrl: 'https://www.ikea.com/sg/en/p/knarrevik-bedside-table-black-80576319/',
  manualUrl: 'https://www.ikea.com/sg/en/assembly_instructions/knarrevik-bedside-table-black__AA-2547698-1-100.pdf',
  revision: 'AA-2547698-1',
  parts: [
    {id:'tray', name:'Metal trays', expected:2, code:'', page:7, exampleId:'tray-bottom', description:'Two solid rectangular trays with folded edges. The edges are integral, not separate rails.', use:'One tray forms the lower shelf (steps 1–3); the other forms the top (steps 4–5). A single photo may not distinguish them.'},
    {id:'leg', name:'Angle legs', expected:4, code:'', page:9, exampleId:'leg-1', description:'Four separate long metal angle sections with screw holes. Not two preassembled side frames.', use:'Each leg attaches to both trays. Steps 1–3 attach the lower tray; steps 4–5 secure the top.'},
    {id:'screw', name:'Assembly screws', expected:16, code:'10118490 / 10118469', page:6, exampleId:'screw-1', description:'16 screws in total. The manual lists alternative codes; these are not two sets of 16.', use:'Leave screws loose during steps 1–5. Stand the table upright and tighten all 16 in step 6. Check the supplied hardware against page 6.'},
    {id:'hex_key', name:'Hex key', expected:1, code:'100006', page:6, exampleId:'hex-key', description:'One L-shaped hex key. A tool, not a permanent table component.', use:'The supplied key is used to insert and tighten the screws. It stays outside the finished table.'},
  ],
});

// Authored schematic for identification, not generated assembly instructions or CAD.
export function knarrevikReferenceGuide() {
  const parts=[];
  const box=(size,position=[0,0,0])=>({shape:'box',size,position,rotation:[0,0,0]});
  const part=(id,name,position,primitives,kind='part',sourcePage=7)=>({id,name,parentId:'',kind,sourcePage,color:kind==='part'?'#30343b':'#a3abb7',position,rotation:[0,0,0],explodedOffset:[0,0,0],initiallyVisible:true,primitives});
  for(const [id,y] of [['tray-bottom',.44],['tray-top',1.34]])parts.push(part(id,id==='tray-top'?'Top tray':'Lower tray',[0,y,0],[box([1.11,.016,.84]),box([1.11,.07,.014],[0,-.025,.413]),box([1.11,.07,.014],[0,-.025,-.413]),box([.014,.07,.84],[.548,-.025,0]),box([.014,.07,.84],[-.548,-.025,0])]));
  let n=0,s=0;
  for(const x of [-.535,.535])for(const z of [-.4,.4]){
    parts.push(part(`leg-${++n}`,`Angle leg ${n}`,[x,.675,z],[box([.045,1.35,.012]),box([.012,1.35,.045],[Math.sign(x)*.016,0,Math.sign(z)*.016])],'part',9));
    for(const y of [.415,1.315])for(const face of [0,1])parts.push(part(`screw-${++s}`,`Assembly screw ${s}`,[x+(face?Math.sign(x)*.025:0),y,z+(face?0:Math.sign(z)*.025)],[{shape:'sphere',size:[.027,.027,.027],position:[0,0,0],rotation:[0,0,0]}],'hardware',6));
  }
  parts.push(part('hex-key','Hex key',[.77,.018,.15],[box([.018,.018,.25]),box([.08,.018,.018],[.03,0,.115])],'tool',6));
  return {schemaVersion:'1',productName:'KNARREVIK · parts reference',summary:'Authored schematic for identifying parts. Follow the IKEA manual for assembly.',pageCount:12,reviewNotes:[],parts,steps:[{title:'Parts reference',instruction:'Select a part type to highlight one example. This schematic does not certify dimensions or connections.',sourcePage:12,duration:3,orientation:'upright',focus:[0,.65,0],cameraDirection:[1,.7,1],cameraDistance:3,reviewNotes:[],actions:[]}]};
}
