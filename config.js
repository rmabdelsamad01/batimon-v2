const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});
let sbUser = null;
let sbProfile = null;

const PROJECT_META = {
  'shift-tower':     {name:'Shift Tower',     active:true,  members:['raed']},
  'riad-el-andalous':{name:'Riad El Andalous', active:false, members:['anas']},
  'taghazout':       {name:'Taghazout',       active:false, members:['anas']},
};
