import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Building2 } from 'lucide-react'
import { clientsApi, type Client } from '@/api/workflow'

export default function ClientsPage() {
  const navigate = useNavigate()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    loadClients()
  }, [])

  const loadClients = async () => {
    setLoading(true)
    try {
      const data = await clientsApi.list()
      setClients(data)
    } catch (err) {
      console.error('Failed to load clients:', err)
    } finally {
      setLoading(false)
    }
  }

  const filtered = clients.filter(c =>
    (c.company ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (c.division ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (c.email ?? '').toLowerCase().includes(search.toLowerCase())
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-full">
        <div className="text-gray-500">Loading clients...</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6 min-h-full bg-gray-50">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-lg">
            <Building2 size={24} className="text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Clients</h1>
            <p className="text-sm text-gray-600">{clients.length} total</p>
          </div>
        </div>
        <button
          onClick={() => navigate('/clients/new')}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
        >
          <Plus size={20} />
          New Client
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <input
          type="text"
          placeholder="Search by company, division, or email..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            No clients found
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-100 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Company</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Division</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Contact</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Email</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Status</th>
                <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filtered.map(client => (
                <tr key={client.id} className="hover:bg-gray-50 transition">
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">{client.company}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{client.division}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {client.first_name && client.surname ? `${client.first_name} ${client.surname}` : '-'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{client.email}</td>
                  <td className="px-6 py-4 text-sm">
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      client.active_status
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {client.active_status ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right text-sm space-x-2">
                    <button
                      onClick={() => navigate(`/clients/${client.id}`)}
                      className="text-blue-600 hover:text-blue-800 font-medium"
                    >
                      View
                    </button>
                    <button
                      onClick={() => navigate(`/clients/${client.id}/edit`)}
                      className="text-gray-600 hover:text-gray-800 font-medium"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
