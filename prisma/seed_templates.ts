import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
  const dir = path.join(process.cwd(), '..', '..', 'MAQUETTE', 'extracted');
  if (!fs.existsSync(dir)) {
    console.warn('Maquette directory not found:', dir);
    return;
  }
  const account = await prisma.account.findFirst({ select: { id: true } });
  if (!account) {
    throw new Error(
      'No account found. Create one account before seeding templates.',
    );
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.html'));
  for (const file of files) {
    const filePath = path.join(dir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const titleMatch = /<title>(.*?)<\/title>/i.exec(content);
    const name = titleMatch
      ? titleMatch[1].trim()
      : file.replace(/\.html$/, '');
    const key = file
      .replace(/\.html$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '-');
    const channelType = content.includes('<body') ? 'email' : 'sms';
    await prisma.template.upsert({
      where: { key },
      update: { htmlContent: content, name, channelType },
      create: {
        accountId: account.id,
        key,
        name,
        channelType,
        htmlContent: content,
        contentText: null,
        variables: undefined,
        createdBy: null,
        isPreset: true,
      },
    });
    console.log('Upserted template', key);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
