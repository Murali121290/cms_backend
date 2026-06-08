import api from './client'

export interface Client {
  id: number
  category_type: string
  contact_type: string
  first_name: string | null
  surname: string | null
  name_company: string | null
  company: string | null
  division: string | null
  designation: string | null
  department: string | null
  email: string | null
  website: string | null
  vendor_number: string | null
  address1: string | null
  address2: string | null
  city: string | null
  state: string | null
  country: string | null
  zip_code: string | null
  sub_specialisation: string | null
  working_hours: string | null
  contact_hours: string | null
  phone_main: string | null
  phone_additional: string | null
  active_status: boolean
  created_by: number | null
  created_at: string
  updated_at: string
}

export interface ClientPayload {
  category_type: string
  contact_type: string
  first_name?: string
  surname?: string
  name_company?: string
  company: string
  division: string
  designation?: string
  department?: string
  email: string
  website?: string
  vendor_number?: string
  address1?: string
  address2?: string
  city?: string
  state?: string
  country?: string
  zip_code?: string
  sub_specialisation?: string
  working_hours?: string
  contact_hours?: string
  phone_main?: string
  phone_additional?: string
  active_status?: boolean
}

export const clientsApi = {
  list: () =>
    api.get<Client[]>('/api/v1/clients').then(r => r.data),

  getById: (id: number) =>
    api.get<Client>(`/api/v1/clients/${id}`).then(r => r.data),

  create: (data: ClientPayload) =>
    api.post<Client>('/api/v1/clients', data).then(r => r.data),

  update: (id: number, data: Partial<ClientPayload>) =>
    api.put<Client>(`/api/v1/clients/${id}`, data).then(r => r.data),

  setStatus: (id: number, active_status: boolean) =>
    api.patch<Client>(`/api/v1/clients/${id}/status`, { active_status }).then(r => r.data),
}

