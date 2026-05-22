(async ()=>{
  try{
    require('dotenv').config({path: './.env'});
    const {PrismaClient} = require('@prisma/client');
    const prisma = new PrismaClient();
    const accountEmail = 'romualdndri9@gmail.com';
    const account = await prisma.account.findUnique({ where: { adminEmail: accountEmail } });
    if (!account) { console.log('Account not found'); process.exit(0); }
    const sends = await prisma.send.findMany({ where: { contact: { accountId: account.id } }, include: { campaign: true, contact: true }, orderBy: { sentAt: 'desc' }, take: 20 });
    console.log('Sends for account', account.id, sends.map(s=>({id:s.id,campaignId:s.campaignId,status:s.status,variant:s.variant,sentAt:s.sentAt,contact:s.contact}))); process.exit(0);
  }catch(e){console.error(e);process.exit(1);} })();
