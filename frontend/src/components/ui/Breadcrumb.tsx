import { Fragment } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/utils/cn";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumb({ items, className }: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className={cn("flex items-center", className)}>
      <ol className="flex items-center flex-wrap gap-0.5">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;

          return (
            <Fragment key={`${item.label}-${index}`}>
              <li className="flex items-center">
                {isLast || !item.href ? (
                  <span
                    aria-current={isLast ? "page" : undefined}
                    className={cn(
                      "text-sm leading-none",
                      isLast
                        ? "font-semibold text-navy-900"
                        : "text-navy-400"
                    )}
                  >
                    {item.label}
                  </span>
                ) : (
                  <Link
                    to={item.href}
                    className="text-sm leading-none text-navy-400 hover:text-navy-900 transition-colors duration-100 rounded-sm"
                  >
                    {item.label}
                  </Link>
                )}
              </li>

              {!isLast && (
                <li aria-hidden="true" className="flex items-center">
                  <ChevronRight className="size-3.5 text-navy-300 shrink-0" />
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
