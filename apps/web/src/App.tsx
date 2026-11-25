import { useEffect } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'
import { NotebookPen } from 'lucide-react'
import { auth } from './auth/store'
import { GuestOnly, RequireAuth } from './auth/guards'
import { AppShell } from './layout/AppShell'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { CalendarPage } from './pages/CalendarPage'
import { JournalPage } from './pages/JournalPage'
import { MePage } from './pages/MePage'
import { SearchPage } from './pages/SearchPage'
import { TasksPage } from './pages/TasksPage'
import { TodayPage } from './pages/TodayPage'
import { InboxPage } from './pages/InboxPage'
import { NotificationSettingsPage } from './pages/NotificationSettingsPage'
import { StylesPage } from './pages/StylesPage'
import { LoginPage } from './pages/auth/LoginPage'
import { RegisterPage } from './pages/auth/RegisterPage'
import { ForgotPasswordPage, LegalPage, ResetPasswordPage, VerifyEmailPage } from './pages/auth/PasswordPages'

export function App() {
  useEffect(() => {
    void auth.bootstrap()
  }, [])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="login" element={<GuestOnly><LoginPage /></GuestOnly>} />
        <Route path="register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
        <Route path="forgot-password" element={<ForgotPasswordPage />} />
        <Route path="reset-password" element={<ResetPasswordPage />} />
        <Route path="verify-email" element={<VerifyEmailPage />} />
        <Route path="terms" element={<LegalPage kind="terms" />} />
        <Route path="privacy" element={<LegalPage kind="privacy" />} />
        <Route element={<RequireAuth><AppShell /></RequireAuth>}>
          <Route index element={<TodayPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="journal" element={<JournalPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="me" element={<MePage />} />
          <Route path="me/notifications" element={<NotificationSettingsPage />} />
          <Route path="inbox" element={<InboxPage />} />
          <Route path="styles" element={<StylesPage />} />
          <Route path="*" element={<PlaceholderPage icon={NotebookPen} title="页面不存在" desc="检查一下地址，或者回到今天。" />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
