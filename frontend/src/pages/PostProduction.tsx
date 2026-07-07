import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Layers, FileText, Download, ChevronRight } from 'lucide-react'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { POST_PROD_SERVICES } from '@/config/postProdConfig'

export function PostProduction() {
  useDocumentTitle('Post Production — S4Carlisle CMS')
  const navigate = useNavigate()

  return (
    <div className="space-y-8 max-w-7xl mx-auto p-6 text-text">
      <div>
        <h1 className="text-3xl font-bold font-serif text-text tracking-tight">Post Production Hub</h1>
        <p className="text-sm text-muted mt-1">Configurable pre-press and conversion services pipeline</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {POST_PROD_SERVICES.map((service) => {
          const isEnabled = service.enabled
          return (
            <div 
              key={service.id}
              onClick={() => isEnabled && navigate(`/post-production/${service.id}`)}
              className={`p-6 rounded-2xl border transition-all duration-300 flex flex-col justify-between ${
                isEnabled 
                  ? 'bg-card border-border hover:border-primary/50 cursor-pointer hover:shadow-2xl hover:shadow-primary/5' 
                  : 'bg-card/40 border-border opacity-50 cursor-not-allowed'
              }`}
            >
              <div className="space-y-4">
                <div className={`p-3.5 rounded-xl w-fit ${isEnabled ? 'bg-primary/10 text-primary' : 'bg-accent text-muted'}`}>
                  {service.icon === 'FileText' && <FileText size={24} />}
                  {service.icon === 'Layers' && <Layers size={24} />}
                  {service.icon === 'Download' && <Download size={24} />}
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-text flex items-center gap-2">
                    {service.title}
                    {!isEnabled && (
                      <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 bg-accent text-muted rounded-full">
                        Coming Soon
                      </span>
                    )}
                  </h3>
                  <p className="text-sm text-muted mt-1.5 leading-relaxed">{service.description}</p>
                </div>
              </div>

              {isEnabled && (
                <div className="mt-6 flex items-center text-xs text-primary font-semibold gap-1">
                  Enter Workspace <ChevronRight size={14} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
