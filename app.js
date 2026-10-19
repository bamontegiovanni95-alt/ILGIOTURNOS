const $=id=>document.getElementById(id);
const staff={boedo:[{id:"lautaro",name:"Lautaro",start:9,end:14},{id:"julieta",name:"Julieta",start:14,end:20}],matheu:[{id:"brai",name:"Brai",start:9,end:20},{id:"thiago",name:"Thiago",start:11,end:20}]};
const loc=$("location"),barber=$("barber"),date=$("date"),slots=$("slots"),time=$("selectedTime"),msg=$("message");let chosen="";
const now=new Date();date.min=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
const service=()=>{const r=document.querySelector('input[name="service"]:checked');return {name:r.value,price:+r.dataset.price}};
const money=n=>new Intl.NumberFormat("es-AR").format(n);
function note(t,c){msg.textContent=t;msg.className="show "+c}
function clear(){msg.textContent="";msg.className=""}
function summary(){const s=service();$("summary").textContent=`${s.name} · $${money(s.price)} · 30 min`}
function setBarbers(){const list=staff[loc.value]||[];barber.innerHTML='<option value="">Seleccionar barbero</option>'+list.map(b=>`<option value="${b.id}">${b.name}</option>`).join("");barber.disabled=!list.length;chosen="";time.value="";slots.innerHTML='<div class="empty">Elegí barbero y día para consultar horarios.</div>';clear()}
function clock(n){return String(n).padStart(2,"0")}
async function getSlots(){chosen="";time.value="";clear();if(!loc.value||!barber.value||!date.value){slots.innerHTML='<div class="empty">Elegí local, barbero y día para consultar horarios.</div>';return}
const b=(staff[loc.value]||[]).find(x=>x.id===barber.value);let all=[];for(let m=b.start*60;m+30<=b.end*60;m+=30)all.push(`${clock(Math.floor(m/60))}:${clock(m%60)}`);
$("hint").textContent="Consultando…";
try{const r=await fetch(`/.netlify/functions/availability?location=${loc.value}&barber=${barber.value}&date=${date.value}`);if(!r.ok)throw Error();const data=await r.json(),booked=new Set(data.booked||[]);const d=new Date(),today=`${d.getFullYear()}-${clock(d.getMonth()+1)}-${clock(d.getDate())}`;const free=all.filter(t=>!booked.has(t)&&!(date.value===today&&t<=`${clock(d.getHours())}:${clock(d.getMinutes())}`));
slots.innerHTML=free.length?free.map(t=>`<button type="button" class="slot" data-time="${t}">${t}</button>`).join(""):'<div class="empty">No quedan horarios libres. Probá otra fecha.</div>';
slots.querySelectorAll("button").forEach(btn=>btn.onclick=()=>{slots.querySelectorAll("button").forEach(x=>x.classList.remove("selected"));btn.classList.add("selected");chosen=btn.dataset.time;time.value=chosen;clear()});$("hint").textContent=`${free.length} horarios disponibles`;
}catch{slots.innerHTML='<div class="empty">La agenda todavía no está conectada. Seguí los pasos del archivo LEEME.md para activar reservas.</div>';$("hint").textContent="Configuración pendiente"}}
loc.onchange=setBarbers;barber.onchange=getSlots;date.onchange=getSlots;document.querySelectorAll('[name="service"]').forEach(x=>x.onchange=summary);
$("bookingForm").onsubmit=async e=>{e.preventDefault();clear();if(!chosen){note("Elegí un horario disponible antes de confirmar.","error");return}
const s=service(),body={location:loc.value,barber:barber.value,date:date.value,time:chosen,service:s.name,price:s.price,duration:30,name:$("name").value.trim(),phone:$("phone").value.trim()};
$("submit").disabled=true;$("submit").textContent="Registrando…";
try{const r=await fetch("/.netlify/functions/bookings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),data=await r.json();if(!r.ok)throw Error(data.error||"No se pudo registrar el turno.");const person=staff[body.location].find(x=>x.id===body.barber);note(`¡Turno confirmado! ${body.date} a las ${body.time} con ${person.name}. ${s.name} · $${money(s.price)}.`,"success");await getSlots()}catch(err){note(err.message,"error");await getSlots()}finally{$("submit").disabled=false;$("submit").textContent="Confirmar reserva →"}};
summary();