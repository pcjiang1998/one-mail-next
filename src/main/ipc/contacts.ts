import { ipcMain } from 'electron'

import { deleteContact, listContacts, saveContact } from '../db/repositories/contact.repository'
import type { ContactInput } from './types'
import { exportVCardToDisk, importVCardFromDisk } from '../services/vcard'

export function registerContactsIpc(): void {
  ipcMain.handle('contacts/list', (_event, search?: string) => listContacts(search))
  ipcMain.handle('contacts/save', (_event, input: ContactInput) => saveContact(input))
  ipcMain.handle('contacts/delete', (_event, contactId: number) => deleteContact(contactId))
  ipcMain.handle('contacts/importVCard', () => importVCardFromDisk())
  ipcMain.handle('contacts/exportVCard', (_event, contactIds?: number[]) =>
    exportVCardToDisk(contactIds)
  )
}
