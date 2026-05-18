import { BrandHeader } from '@/components/BrandHeader';
import { LoginForm } from './login-form';

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-stone-50">
      <BrandHeader subtitle="Authorized personnel only" />
      <main className="mx-auto max-w-md px-4 py-12 sm:py-16">
        <h2 className="font-heading text-2xl text-stone-800">Sign in</h2>
        <p className="mt-1 text-sm text-stone-600">Use your employee portal credentials.</p>
        <div className="mt-8">
          <LoginForm />
        </div>
      </main>
    </div>
  );
}
