import 'dotenv/config';
import 'reflect-metadata';
import * as bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { PlanSchema } from '../auth/schemas/plan.schema.js';
import { PlanInstanceSchema } from '../auth/schemas/plan-instance.schema.js';
import { PlanInstanceStatus } from '../auth/plan-instance-status.enum.js';
import { UserSchema } from '../auth/schemas/user.schema.js';
import { UserRole } from '../auth/user-role.enum.js';

const mongoUri =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/deepti_sherawat';
const UserModel = mongoose.model('User', UserSchema);
const PlanModel = mongoose.model('Plan', PlanSchema);
const PlanInstanceModel = mongoose.model('PlanInstance', PlanInstanceSchema);

function requiredSeedValue(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} must be set before running the seed script`);
  }

  return value;
}

const accounts = [
  {
    name: 'Deepti Sherawat Admin',
    email: requiredSeedValue('SEED_ADMIN_EMAIL'),
    password: requiredSeedValue('SEED_ADMIN_PASSWORD'),
    role: UserRole.Admin,
  },
  {
    name: 'Demo User',
    email: requiredSeedValue('SEED_USER_EMAIL'),
    password: requiredSeedValue('SEED_USER_PASSWORD'),
    role: UserRole.User,
  },
  {
    name: 'Demo Nutritionist',
    email: requiredSeedValue('SEED_NUTRITIONIST_EMAIL'),
    password: requiredSeedValue('SEED_NUTRITIONIST_PASSWORD'),
    role: UserRole.Nutritionist,
  },
];

const plans = [
  {
    name: 'Metabolic balance',
    description: 'Steadier energy, balanced meals and useful markers over time.',
    durationDays: 30,
    validityDays: 30,
    formFillingDays: 30,
    questions: [
      { id: 'metabolic-energy', label: 'How would you rate your energy today?', type: 'scale', required: true, repeatPerDay: 1 },
      { id: 'metabolic-meals', label: 'What did you eat today?', type: 'text', required: true, repeatPerDay: 4, unit: 'meal' },
    ],
  },
  {
    name: 'Gut restoration',
    description: 'Create a calmer digestive rhythm through food and daily practice.',
    durationDays: 21,
    validityDays: 21,
    formFillingDays: 21,
    questions: [
      { id: 'gut-comfort', label: 'How comfortable was your digestion today?', type: 'scale', required: true, repeatPerDay: 1 },
      { id: 'gut-notes', label: 'Share any digestive observations.', type: 'text', required: false, repeatPerDay: 1 },
    ],
  },
  {
    name: 'Energy + sleep',
    description: 'Make the relationship between nourishment, rest and recovery visible.',
    durationDays: 28,
    validityDays: 28,
    formFillingDays: 28,
    questions: [
      { id: 'sleep-hours', label: 'How many hours did you sleep?', type: 'number', required: true, repeatPerDay: 1 },
      { id: 'sleep-quality', label: 'How did you sleep last night?', type: 'scale', required: true, repeatPerDay: 1 },
    ],
  },
];

async function seed() {
  await mongoose.connect(mongoUri);

  for (const plan of plans) {
    await PlanModel.updateOne(
      { name: plan.name },
      { $set: { ...plan, active: true } },
      { upsert: true },
    );
  }

  for (const account of accounts) {
    const passwordHash = await bcrypt.hash(account.password, 12);
    await UserModel.updateOne(
      { email: account.email.toLowerCase() },
      {
        $set: {
          name: account.name,
          email: account.email.toLowerCase(),
          passwordHash,
          role: account.role,
          dashboardUnlocked: true,
        },
      },
      { upsert: true },
    );
  }

  const [demoUser, demoNutritionist, demoPlan] = await Promise.all([
    UserModel.findOne({ email: accounts[1].email.toLowerCase(), role: UserRole.User })
      .select('_id nutritionistId planId')
      .exec(),
    UserModel.findOne({ email: accounts[2].email.toLowerCase(), role: UserRole.Nutritionist })
      .select('_id')
      .exec(),
    PlanModel.findOne({ name: 'Metabolic balance', active: true })
      .select('_id name durationDays validityDays formFillingDays questions')
      .exec(),
  ]);

  if (demoUser && demoNutritionist && demoPlan) {
    const assignmentUpdate: Record<string, string> = {};
    if (!demoUser.nutritionistId) {
      assignmentUpdate.nutritionistId = demoNutritionist._id.toString();
    }
    if (!demoUser.planId) {
      assignmentUpdate.planId = demoPlan._id.toString();
    }
    if (Object.keys(assignmentUpdate).length) {
      await UserModel.updateOne({ _id: demoUser._id }, { $set: assignmentUpdate });
    }

    const existingInstance = await PlanInstanceModel.findOne({
      templateId: demoPlan._id.toString(),
      userId: demoUser._id.toString(),
    })
      .select('_id')
      .exec();

    if (!existingInstance) {
      const assignedAt = new Date();
      const planValidityDays = demoPlan.validityDays ?? demoPlan.durationDays;
      const formFillingDays = demoPlan.formFillingDays ?? demoPlan.durationDays;
      await PlanInstanceModel.create({
        templateId: demoPlan._id.toString(),
        userId: demoUser._id.toString(),
        nutritionistId: demoNutritionist._id.toString(),
        userNameSnapshot: accounts[1].name,
        userEmailSnapshot: accounts[1].email,
        templateName: demoPlan.name,
        planValidityDays,
        formFillingDays,
        questions: demoPlan.questions,
        answers: [],
        status: PlanInstanceStatus.Assigned,
        assignedAt,
        dueAt: new Date(assignedAt.getTime() + formFillingDays * 24 * 60 * 60 * 1000),
        planValidUntil: new Date(assignedAt.getTime() + planValidityDays * 24 * 60 * 60 * 1000),
      });
    }
  }

  console.log(`Seeded ${accounts.length} accounts and ${plans.length} plans`);
}

seed()
  .catch((error: unknown) => {
    console.error('Database seed failed', {
      errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
