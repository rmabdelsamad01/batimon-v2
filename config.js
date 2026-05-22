const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});
let sbUser = null;
let sbProfile = null;

const PROJECT_META = {
  'shift-tower':     {name:'Shift Tower',     active:true,  members:['raed','anas','nabil']},
  'tanger-med':      {name:'Tanger MED',      active:false, members:['raed']},
  'riad-el-andalous':{name:'Riad El Andalous', active:false, members:['anas']},
  'anp':             {name:'ANP',             active:false, members:['nabil']},
  'taghazout':       {name:'Taghazout',       active:false, members:['raed','anas']},
  'casaone':         {name:'Casaone',         active:false, members:['nabil']},
};
