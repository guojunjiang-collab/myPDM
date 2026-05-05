const fs = require('fs');
const f = 'C:/Users/guoju/Desktop/BOM Tool/frontend/js/pages-parts.js';
let c = fs.readFileSync(f, 'utf8');
c = c.replace(
  "(Auth.canDownload() ? '<button class=\"btn-outline\" onclick=\"Parts._exportParts()\">📥 导出Excel</button>' : '') +\n        (canE ? '<button class=\"btn-primary\" id=\"btn-add-part\">＋ 新增零件</button>' : '')",
  "(Auth.canDownload() ? '<button class=\"btn-outline\" onclick=\"Parts._exportParts()\">📥 导出Excel</button>' : '') +\n        (Auth.canEdit() ? '<button class=\"btn-outline\" onclick=\"Parts._importParts()\">📤 导入Excel</button>' : '') +\n        (canE ? '<button class=\"btn-primary\" id=\"btn-add-part\">＋ 新增零件</button>' : '')"
);
fs.writeFileSync(f, c, 'utf8');
console.log('done');
