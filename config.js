const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});
let sbUser = null;
let sbProfile = null;

const PROJECT_META = {
  'shift-tower':     {name:'Shift Tower',     active:true},
  'tanger-med':      {name:'Tanger MED',      active:false},
  'riad-el-andalous':{name:'Riad El Andalous', active:false},
  'anp':             {name:'ANP',             active:false},
  'taghazout':       {name:'Taghazout',       active:false},
  'casaone':         {name:'Casaone',         active:false},
};
