import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Layers, FileText, Download, ChevronRight, Lock } from 'lucide-react'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { POST_PROD_SERVICES } from '@/config/postProdConfig'

export function PostProduction() {
  useDocumentTitle('Backlist — S4Carlisle CMS')
  const navigate = useNavigate()

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-6 text-text">
      {/* Title section with tight spacing */}
      <div className="border-b border-border/60 pb-4">
        <h1 className="text-2xl font-bold font-serif text-text tracking-tight m-0">S4C Backlist Hub</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {POST_PROD_SERVICES.map((service) => {
          const isEnabled = service.enabled
          return (
            <div
              key={service.id}
              onClick={() => {
                if (!isEnabled) return
                if (service.externalUrl) {
                  window.open(service.externalUrl, '_blank', 'noopener,noreferrer')
                } else {
                  navigate(`/post-production/${service.id}`)
                }
              }}
              className={`p-5 rounded-xl border transition-all duration-300 flex flex-col justify-between ${isEnabled
                ? 'bg-card border-border hover:border-primary/60 hover:-translate-y-0.5 hover:shadow-md cursor-pointer'
                : 'bg-card/50 border-border/60 opacity-60 cursor-not-allowed'
                }`}
            >
              <div className="space-y-3.5">
                <div className="flex items-start justify-between">
                  <div className={`p-2.5 rounded-lg w-fit ${isEnabled ? 'bg-primary/10 text-primary' : 'bg-muted/10 text-muted'}`}>
                    {service.icon === 'FileText' && <FileText size={20} />}
                    {service.icon === 'Layers' && <Layers size={20} />}
                    {service.icon === 'Download' && <Download size={20} />}
                  </div>
                  {!isEnabled ? (
                    <span className="flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 bg-muted/10 text-muted rounded-md">
                      <Lock size={10} /> Coming Soon
                    </span>
                  ) : (
                    <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 bg-primary/10 text-primary rounded-md">
                      Active Service
                    </span>
                  )}
                </div>
                <div>
                  <h3 className="text-base font-semibold text-text m-0">
                    {service.title}
                  </h3>
                  <p className="text-xs text-muted mt-1.5 leading-relaxed">{service.description}</p>
                </div>
              </div>

              {isEnabled && (
                <div className="mt-5 flex items-center text-xs text-primary font-bold gap-1 group cursor-pointer">
                  <span>Enter Workspace</span>
                  <ChevronRight size={13} className="transition-transform group-hover:translate-x-0.5" />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

