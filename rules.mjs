export const MODES=[
  {name:'Underthink',factor:2/3,label:'⅔',hint:'Aim below the group. How far will everyone go?'},
  {name:'Overshoot',factor:4/3,label:'4/3',hint:'Aim above the average. Expect everyone else to do the same.'},
  {name:'Undercurrent',factor:.8,label:'0.8',hint:'Just below the group. A smaller adjustment, a harder read.'},
  {name:'Upward drift',factor:1.2,label:'1.2',hint:'A little above average. Leave yourself room to move.'},
];
export function resolveGuesses(ballots,factor){
  const entries=Object.entries(ballots),average=entries.length?entries.reduce((n,[,a])=>n+a.choice,0)/entries.length:0;
  const target=Math.min(100,Math.max(0,average*factor));
  if(entries.length<2)return{average,target,valid:false,winners:[],results:{}};
  const closest=Math.min(...entries.map(([,a])=>Math.abs(a.choice-target)));
  const winners=entries.filter(([,a])=>Math.abs(Math.abs(a.choice-target)-closest)<1e-8).map(([id])=>id);
  const results=Object.fromEntries(entries.map(([id,a])=>{const distance=Math.abs(a.choice-target),winner=winners.includes(id),accuracy=Math.max(0,Math.round(1000-20*distance));return[id,{choice:a.choice,distance,accuracy,winner,earned:accuracy+(winner?250:0)}];}));
  return{average,target,valid:true,winners,results};
}
