'use strict';
window.RenoWorkspace=(()=>{
 const el=id=>document.getElementById(id);
 let loaded=false;
 function filter(){
  if(!loaded)return;
  const query=el('project-search').value.trim().toLocaleLowerCase(),state=el('project-filter').value;
  const cards=[...el('list').querySelectorAll('[data-project-state]')];let visible=0;
  for(const card of cards){card.hidden=!(state==='all'||card.dataset.projectState===state)||!card.dataset.search.includes(query);if(!card.hidden)visible++;}
  el('list-count').textContent=`显示 ${visible} / ${cards.length} 个项目`;
  el('search-empty').hidden=!cards.length||visible>0;
 }
 function update(records){
  loaded=true;
  el('project-overview').hidden=false;
  el('count-all').textContent=records.length;
  el('count-draft').textContent=records.filter(p=>p.state==='draft').length;
  el('count-active').textContent=records.filter(p=>['confirmed','executing'].includes(p.state)).length;
  el('count-accepted').textContent=records.filter(p=>p.state==='accepted').length;
  el('count-all').nextElementSibling.textContent=records.length===200?'最近 200 个主订单':'当前加载的主订单';
  filter();
 }
 el('project-search').addEventListener('input',filter);
 el('project-filter').addEventListener('change',filter);
 el('clear-project-filter').addEventListener('click',()=>{el('project-search').value='';el('project-filter').value='all';filter();el('project-search').focus();});
 // Scroll without changing the project UUID stored in the URL hash.
 document.querySelector('.steps').addEventListener('click',e=>{
  const link=e.target.closest('a[href^="#"]');if(!link)return;
  const section=el(link.getAttribute('href').slice(1));if(!section)return;
  e.preventDefault();section.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
  document.querySelectorAll('.steps a').forEach(a=>a.removeAttribute('aria-current'));link.setAttribute('aria-current','location');
 });
 if('IntersectionObserver' in window){
  const observer=new IntersectionObserver(entries=>{
   const active=entries.filter(e=>e.isIntersecting).sort((a,b)=>a.boundingClientRect.top-b.boundingClientRect.top)[0];if(!active)return;
   document.querySelectorAll('.steps a').forEach(a=>{if(a.getAttribute('href')==='#'+active.target.id)a.setAttribute('aria-current','location');else a.removeAttribute('aria-current');});
  },{rootMargin:'-135px 0px -50% 0px',threshold:0});
  document.querySelectorAll('#editor>.panel').forEach(section=>observer.observe(section));
 }
 function setEditor(active){document.body.classList.toggle('editing-project',active);}
 return {update,setEditor};
})();
