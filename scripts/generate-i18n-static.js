import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {load} from 'cheerio';
import {staticEnglish,chineseOverrides,staticAttributeEnglish} from '../public/i18n/static-source.js';

const pages={thermal:'pilot-thermal',v3:'pilot-v3',pilot:'pilot',search:'index'};
const zh={},en={};
for(const [page,file] of Object.entries(pages)){
  const path=new URL(`../public/${file}.html`,import.meta.url);
  const source=await readFile(path,'utf8');
  if(source.includes('data-i18n='))throw new Error(`${file}.html already has generated annotations`);
  const $=load(source,{decodeEntities:false});
  let index=0;
  $('*').contents().each((_,child)=>{
    if(child.type!=='text'||!child.data.trim())return;
    index++;
    const key=`${page}.static.${index}`;
    const original=child.data.trim();
    const translated=staticEnglish[page][index-1];
    if(translated===undefined)throw new Error(`Missing ${key}: ${original}`);
    zh[key]=chineseOverrides[page]?.[index]??original;
    en[key]=translated;
    const parent=child.parent;
    if(parent.children.length===1){$(parent).attr('data-i18n',key);return;}
    const leading=child.data.match(/^\s*/)[0],trailing=child.data.match(/\s*$/)[0];
    const span=$('<span>').attr('data-i18n',key).text(original);
    $(child).replaceWith(leading+$.html(span)+trailing);
  });
  if(index!==staticEnglish[page].length)throw new Error(`${file}: ${index} text nodes vs ${staticEnglish[page].length} translations`);
  let attrIndex=0;
  $('[placeholder],[aria-label],[title]').each((_,element)=>{
    for(const [attr,dataAttr] of [['placeholder','data-i18n-placeholder'],['aria-label','data-i18n-aria'],['title','data-i18n-title']]){
      const original=$(element).attr(attr);if(!original)continue;
      attrIndex++;
      const key=`${page}.attribute.${attrIndex}`;
      const translated=staticAttributeEnglish[page][attrIndex-1];
      if(translated===undefined)throw new Error(`Missing ${key}: ${original}`);
      zh[key]=original;en[key]=translated;$(element).attr(dataAttr,key);
    }
  });
  if(attrIndex!==staticAttributeEnglish[page].length)throw new Error(`${file}: ${attrIndex} attributes vs ${staticAttributeEnglish[page].length} translations`);
  $('html').attr('lang','zh-CN');
  $('head').append('<link rel="stylesheet" href="/i18n/i18n.css">');
  await writeFile(path,$.html());
}
const dir=new URL('../public/i18n/',import.meta.url);await mkdir(dir,{recursive:true});
await writeFile(new URL('zh-static.js',dir),`export default ${JSON.stringify(zh,null,2)};\n`);
await writeFile(new URL('en-static.js',dir),`export default ${JSON.stringify(en,null,2)};\n`);
