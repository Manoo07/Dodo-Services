import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding Dodo database...')

  // Clear all data (order matters — children before parents)
  await prisma.taskTag.deleteMany()
  await prisma.reminder.deleteMany()
  await prisma.task.deleteMany()
  await prisma.section.deleteMany()
  await prisma.tag.deleteMany()
  await prisma.list.deleteMany()
  await prisma.folder.deleteMany()
  await prisma.user.deleteMany()

  // ── Demo user ──────────────────────────────────────────────────────────────
  const password = await bcrypt.hash('password123', 12)
  const user = await prisma.user.create({
    data: {
      name: 'Demo User',
      email: 'demo@dodo.app',
      password,
      emailVerified: true,
    },
  })

  const personalFolder = await prisma.folder.create({
    data: { name: 'Personal', order: 0, userId: user.id },
  })

  const [inbox, welcome, learning, work, wishlist] = await Promise.all([
    prisma.list.create({ data: { name: 'Inbox', icon: '📥', color: '#636366', order: 0, userId: user.id } }),
    prisma.list.create({ data: { name: 'Welcome', icon: '👋', color: '#4A90D9', order: 1, userId: user.id } }),
    prisma.list.create({
      data: { name: 'Learning', icon: '📖', color: '#34C759', order: 2, folderId: personalFolder.id, userId: user.id },
    }),
    prisma.list.create({
      data: { name: 'Work', icon: '💼', color: '#FF9500', order: 3, folderId: personalFolder.id, userId: user.id },
    }),
    prisma.list.create({ data: { name: 'Wishlist', icon: '⭐', color: '#AF52DE', order: 4, userId: user.id } }),
  ])

  const [learningTag, urgentTag] = await Promise.all([
    prisma.tag.create({ data: { name: 'learning', color: '#34C759', userId: user.id } }),
    prisma.tag.create({ data: { name: 'urgent', color: '#FF3B30', userId: user.id } }),
  ])

  const today = new Date()
  today.setHours(12, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const nextWeek = new Date(today)
  nextWeek.setDate(nextWeek.getDate() + 5)

  await prisma.task.createMany({
    data: [
      { title: 'Sort inbox tasks', listId: inbox.id, order: 0 },
      { title: 'Review project notes', listId: inbox.id, order: 1, dueDate: today },
    ],
  })

  await prisma.task.createMany({
    data: [
      { title: 'Explore Dodo features', listId: welcome.id, order: 0 },
      { title: 'Create your first list', listId: welcome.id, order: 1 },
      { title: 'Try **Markdown** in descriptions', listId: welcome.id, order: 2 },
    ],
  })

  const development = await prisma.task.create({
    data: { title: 'Development', listId: learning.id, order: 0 },
  })

  const [, multiThreading] = await Promise.all([
    prisma.task.create({
      data: { title: 'Java', listId: learning.id, parentId: development.id, order: 0, priority: 'p3' },
    }),
    prisma.task.create({
      data: {
        title: 'Multi Threading',
        listId: learning.id,
        parentId: development.id,
        order: 1,
        priority: 'p2',
        description: `# Multi Threading

Key concepts to cover:

- \`Thread\` vs \`Runnable\`
- **Synchronization** and locks
- \`ExecutorService\` thread pools
- Concurrent collections

\`\`\`java
ExecutorService pool = Executors.newFixedThreadPool(4);
pool.submit(() -> System.out.println("Hello from thread"));
\`\`\`

- [ ] Read Java Concurrency in Practice Ch. 1-3
- [x] Understand thread lifecycle`,
      },
    }),
    prisma.task.create({
      data: { title: 'Angular', listId: learning.id, parentId: development.id, order: 2 },
    }),
  ])

  await prisma.taskTag.create({ data: { taskId: multiThreading.id, tagId: learningTag.id } })

  await Promise.all([
    prisma.task.create({ data: { title: 'System Design', listId: learning.id, order: 1 } }),
    prisma.task.create({ data: { title: 'Devops', listId: learning.id, order: 2 } }),
    prisma.task.create({ data: { title: 'DSA', listId: learning.id, order: 3, dueDate: nextWeek, priority: 'p1' } }),
  ])

  const workParent = await prisma.task.create({
    data: { title: 'Sprint Tasks', listId: work.id, order: 0, dueDate: tomorrow },
  })
  await prisma.task.createMany({
    data: [
      { title: 'Code review PR #42', listId: work.id, parentId: workParent.id, order: 0, dueDate: today, priority: 'p1' },
      { title: 'Update documentation', listId: work.id, parentId: workParent.id, order: 1, priority: 'p3' },
      { title: 'Team standup prep', listId: work.id, order: 1, dueDate: today },
    ],
  })
  await prisma.taskTag.create({ data: { taskId: workParent.id, tagId: urgentTag.id } })

  await prisma.task.createMany({
    data: [
      { title: 'Mechanical keyboard', listId: wishlist.id, order: 0 },
      { title: 'Standing desk', listId: wishlist.id, order: 1 },
    ],
  })

  console.log('Seed complete!')
  console.log(`  Demo login → email: demo@dodo.app  password: password123`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
