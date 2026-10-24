import { ipcMain } from 'electron'

import {
  addContactFromAddress,
  deleteContact,
  deleteContacts,
  deleteContactGroup,
  listContactGroups,
  listContacts,
  saveContact,
  saveContactGroup
} from '../db/repositories/contact.repository'
import type { ContactGroupInput } from '../../shared/types'
import type { ContactInput } from './types'
import { exportVCardToDisk, importVCardFromDisk } from '../services/vcard'

export function registerContactsIpc(): void {
  ipcMain.handle('contacts/list', (_event, search?: string, groupId?: number) =>
    listContacts(search, groupId)
  )
  ipcMain.handle(
    'contacts/addFromAddress',
    (_event, input: { displayName: string; email: string }) => addContactFromAddress(input)
  )
  ipcMain.handle('contacts/listGroups', () => listContactGroups())
  ipcMain.handle('contacts/saveGroup', (_event, input: ContactGroupInput) =>
    saveContactGroup(input)
  )
  ipcMain.handle('contacts/deleteGroup', (_event, groupId: number) => deleteContactGroup(groupId))
  ipcMain.handle('contacts/save', (_event, input: ContactInput) => saveContact(input))
  ipcMain.handle('contacts/delete', (_event, contactId: number) => deleteContact(contactId))
  ipcMain.handle('contacts/deleteMany', (_event, contactIds: number[]) =>
    deleteContacts(contactIds)
  )
  ipcMain.handle('contacts/importVCard', () => importVCardFromDisk())
  ipcMain.handle('contacts/exportVCard', (_event, contactIds?: number[]) =>
    exportVCardToDisk(contactIds)
  )
}
