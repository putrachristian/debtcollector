import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '@/context/AuthContext'
import { BillProvider } from '@/context/BillContext'
import { DebtProvider } from '@/context/DebtContext'
import { AppLayout } from '@/components/AppLayout'
import { HomePage } from '@/pages/HomePage'
import { BillPage } from '@/pages/BillPage'
import { BillNewPage } from '@/pages/BillNewPage'
import { JoinPage } from '@/pages/JoinPage'
import { DebtPage } from '@/pages/DebtPage'
import { AuthPage } from '@/pages/AuthPage'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <BillProvider>
          <DebtProvider>
            <Routes>
              <Route element={<AppLayout />}>
                <Route path="/" element={<HomePage />} />
                <Route path="/bill/new" element={<BillNewPage />} />
                <Route path="/bill/:id" element={<BillPage />} />
                <Route path="/join/:code" element={<JoinPage />} />
                <Route path="/debts" element={<DebtPage />} />
                <Route path="/auth" element={<AuthPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </DebtProvider>
        </BillProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
