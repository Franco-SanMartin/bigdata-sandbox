function s(o,r,c=","){const n=t=>{if(t==null)return"";const e=String(t);return/[",\n\r;]/.test(e)||e.startsWith(" ")||e.endsWith(" ")?`"${e.replace(/"/g,'""')}"`:e};return[o,...r].map(t=>t.map(n).join(c)).join(`\r
`)+`\r
`}function a(o,r,c="text/csv"){const n=URL.createObjectURL(new Blob(["\uFEFF",r],{type:`${c};charset=utf-8`})),t=Object.assign(document.createElement("a"),{href:n,download:o});document.body.appendChild(t),t.click(),t.remove(),setTimeout(()=>URL.revokeObjectURL(n),1e3)}export{a as d,s as t};
