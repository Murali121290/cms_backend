import { Construction } from 'lucide-react'
import { Card, CardBody } from '@/components/ui/Card'

export function Placeholder({ title }: { title: string }) {
  return (
    <Card>
      <CardBody className="flex flex-col items-center justify-center py-20 gap-4">
        <Construction size={40} className="text-muted" />
        <div className="text-center">
          <p className="text-lg font-semibold text-text">{title}</p>
          <p className="text-sm text-muted mt-1">This section is under construction</p>
        </div>
      </CardBody>
    </Card>
  )
}
