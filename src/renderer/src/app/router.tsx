import { createHashRouter, Navigate } from 'react-router'

import { AddAccountPage } from '@renderer/pages/add-account-page'
import { MailboxPage } from '@renderer/pages/mailbox-page'
import { ContactsPage } from '@renderer/pages/contacts-page'
import { BoardPage } from '@renderer/pages/board-page'

export const appRouter = createHashRouter([
  {
    path: '/',
    element: <MailboxPage />
  },
  {
    path: '/accounts/new',
    element: <AddAccountPage />
  },
  {
    path: '/contacts',
    element: <ContactsPage />
  },
  {
    path: '/board',
    element: <BoardPage />
  },
  {
    path: '/settings',
    element: <MailboxPage initialSettingsSection="general" />
  },
  {
    path: '/settings/privacy',
    element: <MailboxPage initialSettingsSection="privacy" />
  },
  {
    path: '/settings/rules',
    element: <MailboxPage initialSettingsSection="rules" />
  },
  {
    path: '/:accountId/:messageId',
    element: <MailboxPage />
  },
  {
    path: '*',
    element: <Navigate to="/" replace />
  }
])
