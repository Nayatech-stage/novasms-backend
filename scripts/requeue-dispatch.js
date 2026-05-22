(async()=>{
  try{
    const { Queue } = require('bullmq');
    const connection = { host: process.env.REDIS_HOST || '127.0.0.1', port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379 };
    const queue = new Queue('campaign-dispatch', { connection });
    const campaignIds = [
      '2f7ee57a-fa2e-4981-a3b8-33a0e75ef7d3', // email campaign
      '8f76d38e-8801-4ee1-8354-ab2647c56ef3', // sms campaign
    ];
    for(const id of campaignIds){
      const job = await queue.add('dispatch-campaign', { campaignId: id, chunkSize: 500 }, { jobId: `dispatch-${id}-requeue-${Date.now()}`, removeOnComplete: true });
      console.log('Queued job', job.id, 'for campaign', id);
    }
    process.exit(0);
  }catch(e){console.error(e);process.exit(1);} })();
