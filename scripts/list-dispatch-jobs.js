(async()=>{
  try{
    const { Queue } = require('bullmq');
    const connection = { host: process.env.REDIS_HOST || '127.0.0.1', port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379 };
    const queue = new Queue('campaign-dispatch',{ connection });
    const counts = await queue.getJobCounts('waiting','active','completed','failed','delayed','waiting-children');
    console.log('Job counts:', counts);
    const failed = await queue.getJobs(['failed'], { start: 0, end: 20 });
    console.log('Failed jobs:', failed.map(j=>({ id:j.id, name:j.name, failedReason: j.failedReason, stacktrace: j.stacktrace, data: j.data })));
    process.exit(0);
  }catch(e){console.error(e);process.exit(1);} })();
