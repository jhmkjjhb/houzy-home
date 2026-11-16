// 从 HOUZY 商品档案提取可用于报价器的瓷砖片价。不同 SKU 的售价保留供人工选择。
(function(root){
  function groups(products) {
    const out = {};
    for (const p of products || []) {
      if (!String(p.category || '').includes('瓷砖') || String(p.unit || '') !== '片') continue;
      const text = `${p.specs || ''} ${p.name || ''}`;
      const m = text.match(/(\d{3,4})\s*[×xX*]\s*(\d{3,4})(?:\s*[×xX*]\s*\d+)?/);
      const finish = text.includes('哑光') ? '哑光' : text.includes('亮光') ? '普通亮面' : null;
      const price = Number(p.price);
      if (!m || !finish || !Number.isFinite(price) || price < 0) continue;
      const size = `${m[1]}×${m[2]} mm`, id = `tile.size.${size}.${finish}`;
      (out[id] = out[id] || []).push({sku:String(p.sku || ''),name:String(p.name || ''),price});
    }
    for (const list of Object.values(out)) list.sort((a,b)=>a.price-b.price || a.sku.localeCompare(b.sku));
    return out;
  }
  const api={groups};
  if (typeof module!=='undefined' && module.exports) module.exports=api;
  else root.QV2_TILE_PRODUCTS=api;
})(typeof window!=='undefined'?window:globalThis);
