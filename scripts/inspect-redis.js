(async()=>{
  try{
    const IORedis = require('ioredis');
    const client = new IORedis({ host: process.env.REDIS_HOST || '127.0.0.1', port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379 });
    const keys = await client.keys('bull:campaign-dispatch*');
    console.log('Keys:', keys);
    const failedZ = 'bull:campaign-dispatch:failed';
    const jobs = await client.zrange(failedZ, 0, -1);
    console.log('Failed job ids:', jobs);
    for(const id of jobs){
      const jobKey = `bull:campaign-dispatch:jobs:${id}`;
      const exists = await client.exists(jobKey);
      console.log(jobKey, 'exists?', exists);
      if(exists){
        const data = await client.hget(jobKey, 'data');
        const failedReason = await client.hget(jobKey, 'failedReason');
        console.log('data:', data);
        console.log('failedReason:', failedReason);
      }
    }
    client.disconnect();
    process.exit(0);
  }catch(e){console.error(e);process.exit(1);} })();
