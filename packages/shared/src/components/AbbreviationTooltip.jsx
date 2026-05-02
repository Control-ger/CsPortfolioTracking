import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@shared/components/ui/tooltip";
import { ABBREVIATIONS } from "@shared/lib/constants";
import { HelpCircle } from "lucide-react";
import { cn } from "@shared/lib/utils";

/**
 * Tooltip component for abbreviations
 * Shows full name and description on hover
 */
export function AbbreviationTooltip({ 
  term, 
  children, 
  className,
  showIcon = false,
  iconClassName
}) {
  const info = ABBREVIATIONS[term];
  
  if (!info) {
    // If term is not in our dictionary, just render children
    return children || term;
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn("inline-flex items-center gap-1 cursor-help", className)}>
            {children || term}
            {showIcon && (
              <HelpCircle className={cn("h-3 w-3 text-muted-foreground", iconClassName)} />
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">
          <div className="space-y-0.5">
            <p className="font-medium normal-case">{info.full}</p>
            <p className="text-[10px] text-muted-foreground normal-case leading-tight">{info.description}</p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Inline abbreviation with dotted underline
 */
export function Abbr({ term, className }) {
  return (
    <AbbreviationTooltip term={term} className={cn("border-b border-dotted border-muted-foreground", className)}>
      {term}
    </AbbreviationTooltip>
  );
}
