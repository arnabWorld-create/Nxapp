import { NextResponse } from 'next/server';
import prisma from '../../../../lib/prisma';
import { hashPassword } from '../../../../lib/auth/password';

const indianMobilePattern = /^[6-9]\d{9}$/;

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function validateEmail(value: unknown): string {
  const email = requiredText(value, 'Email').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email must be valid');
  return email;
}

function validateMobile(value: unknown): string {
  const mobile = requiredText(value, 'Mobile Number').replace(/[\s-]/g, '').replace(/^\+91/, '').replace(/^91(?=\d{10}$)/, '');
  if (!indianMobilePattern.test(mobile)) throw new Error('Mobile Number must be a valid Indian mobile number');
  return mobile;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const name = requiredText(body?.name, 'Full Name');
    const email = validateEmail(body?.email);
    const mobileNumber = validateMobile(body?.mobileNumber);
    const city = requiredText(body?.city, 'City');
    const password = requiredText(body?.password, 'Password');
    const confirmPassword = requiredText(body?.confirmPassword, 'Confirm Password');
    const verificationCode = requiredText(body?.verificationCode, 'Company Verification Code');

    if (password.length < 8) throw new Error('Password must be at least 8 characters');
    if (password !== confirmPassword) throw new Error('Passwords do not match');
    if (verificationCode !== (process.env.COMPANY_REGISTRATION_CODE ?? '04102')) throw new Error('Company Verification Code is invalid');

    const role = await prisma.role.findUnique({ where: { name: 'SALES_USER' }, select: { id: true } });
    if (!role) throw new Error('Sales user role is not configured');

    const user = await prisma.user.create({
      data: { name, email, mobile_number: mobileNumber, city, password_hash: hashPassword(password), role_id: role.id, status: 'ACTIVE' },
      select: { id: true },
    });

    return NextResponse.json({ user: { id: user.id } }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message !== 'Sales user role is not configured' && !(error && typeof error === 'object' && 'code' in error && error.code === 'P2002')) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 });
    }
    console.error('Registration error:', error);
    return NextResponse.json({ error: 'Unable to create account' }, { status: 500 });
  }
}