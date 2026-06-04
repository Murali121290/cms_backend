import { useState, useEffect } from 'react'
import { Plus, Trash2, Edit2 } from 'lucide-react'
import { stagesApi, type StageMaster } from '@/api/workflow'

export default function WorkflowStagesPage() {
  const [stages, setStages] = useState<StageMaster[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [formData, setFormData] = useState({
    stage_name: '',
    description: '',
    roles: [] as string[],
  })

  useEffect(() => {
    loadStages()
  }, [])

  const loadStages = async () => {
    setLoading(true)
    try {
      const data = await stagesApi.list()
      setStages(data)
    } catch (err) {
      console.error('Failed to load stages:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      if (editingId) {
        await stagesApi.update(editingId, formData)
      } else {
        await stagesApi.create({
          ...formData,
          stage_activities: [],
          sla_level1: 0,
          sla_level2: 0,
          sla_level3: 0,
          active_status: true,
        })
      }
      resetForm()
      loadStages()
    } catch (err) {
      console.error('Failed to save stage:', err)
    }
  }

  const handleDelete = async (id: number) => {
    if (window.confirm('Delete this stage?')) {
      try {
        await stagesApi.delete(id)
        loadStages()
      } catch (err) {
        console.error('Failed to delete stage:', err)
      }
    }
  }

  const handleEdit = (stage: StageMaster) => {
    setEditingId(stage.id)
    setFormData({
      stage_name: stage.stage_name,
      description: stage.description || '',
      roles: stage.roles || [],
    })
    setShowForm(true)
  }

  const resetForm = () => {
    setEditingId(null)
    setFormData({ stage_name: '', description: '', roles: [] })
    setShowForm(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-full">
        <div className="text-gray-500">Loading stages...</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6 min-h-full bg-gray-50">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Workflow Stages</h1>
          <p className="text-sm text-gray-600">{stages.length} stages defined</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
        >
          <Plus size={20} />
          New Stage
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-white rounded-lg shadow p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Stage Name*</label>
              <input
                type="text"
                required
                value={formData.stage_name}
                onChange={e => setFormData({ ...formData, stage_name: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., Review, Editing, Publishing"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Stage description"
                rows={3}
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
              >
                {editingId ? 'Update' : 'Create'}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-2 bg-gray-300 text-gray-900 rounded-lg hover:bg-gray-400 transition"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {stages.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            No stages defined. Create one to get started.
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-100 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Stage Name</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Description</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Roles</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Status</th>
                <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {stages.map(stage => (
                <tr key={stage.id} className="hover:bg-gray-50 transition">
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">{stage.stage_name}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{stage.description || '-'}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{stage.roles?.join(', ') || '-'}</td>
                  <td className="px-6 py-4 text-sm">
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      stage.active_status
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {stage.active_status ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right space-x-2">
                    <button
                      onClick={() => handleEdit(stage)}
                      className="text-blue-600 hover:text-blue-800 inline-flex items-center gap-1"
                    >
                      <Edit2 size={16} /> Edit
                    </button>
                    <button
                      onClick={() => handleDelete(stage.id)}
                      className="text-red-600 hover:text-red-800 inline-flex items-center gap-1"
                    >
                      <Trash2 size={16} /> Delete
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
