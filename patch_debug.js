const fs = require('fs');
const f = 'C:/Users/guoju/Desktop/BOM Tool/frontend/js/import-export.js';
let c = fs.readFileSync(f, 'utf8');

// 在 _executeImportAssemblies 中加调试 toast
var oldCreate = "          p._newId = result.id;\n          created++;";
var newCreate = "          p._newId = result.id;\n          created++;\n          console.log('[导入] 新建部件:', p.code, 'id=', p._newId);";
c = c.replace(oldCreate, newCreate);

var oldBom = "      var childItems = comp.bomRows.filter(function(r) { return (r['层级'] || 0) > 0; });";
var newBom = "      var childItems = comp.bomRows.filter(function(r) { return (r['层级'] || 0) > 0; });\n      console.log('[导入] 部件', comp.code, '子项数:', childItems.length, 'compId:', compId);";
c = c.replace(oldBom, newBom);

var oldChild = "        if (!child) continue;\n\n        var body = {};";
var newChild = "        if (!child) { console.log('[导入] 子项未找到:', childCode, '类型:', childType); continue; }\n        console.log('[导入] 添加子项:', childCode, '→', comp.code, 'child.id');\n\n        var body = {};";
c = c.replace(oldChild, newChild);

// 关联图文档调试
var oldRel = "      if (relData && relData.length > 0) {";
var newRel = "      console.log('[导入] 关联图文档:', relData.length, '条');\n      if (relData && relData.length > 0) {";
c = c.replace(oldRel, newRel);

fs.writeFileSync(f, c, 'utf8');
console.log('done');
