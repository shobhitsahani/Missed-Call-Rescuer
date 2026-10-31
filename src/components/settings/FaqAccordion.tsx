'use client';

import * as React from 'react';
import { useState } from 'react';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Plus, Trash2, HelpCircle } from 'lucide-react';

export interface FaqItem {
  question: string;
  answer: string;
}

interface FaqAccordionProps {
  faqs: FaqItem[];
  onChange: (faqs: FaqItem[]) => void;
  maxFaqs?: number;
  error?: string;
}

export function FaqAccordion({
  faqs,
  onChange,
  maxFaqs = 20,
  error,
}: FaqAccordionProps) {
  const [openItems, setOpenItems] = useState<string[]>([]);
  const [faqToDelete, setFaqToDelete] = useState<number | null>(null);

  const handleAddFaq = () => {
    if (faqs.length >= maxFaqs) return;
    const newIdx = faqs.length;
    onChange([...faqs, { question: '', answer: '' }]);
    // Open the newly added item automatically
    setOpenItems([`faq-${newIdx}`]);
  };

  const handleConfirmDelete = () => {
    if (faqToDelete !== null) {
      onChange(faqs.filter((_, i) => i !== faqToDelete));
      setFaqToDelete(null);
    }
  };

  const handleUpdate = (index: number, field: 'question' | 'answer', value: string) => {
    const next = [...faqs];
    next[index] = { ...next[index], [field]: value };
    onChange(next);
  };

  return (
    <div className="space-y-4">
      {/* Header row with counter */}
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted-foreground">
          Questions callers frequently ask that the AI agent can answer directly.
        </p>
        <span className="text-xs text-muted-foreground font-mono shrink-0">
          {faqs.length} of {maxFaqs}
        </span>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {/* Accordion list */}
      {faqs.length > 0 ? (
        <Accordion
          type="multiple"
          value={openItems}
          onValueChange={setOpenItems}
          className="border border-border rounded-xl divide-y divide-border overflow-hidden bg-card"
        >
          {faqs.map((faq, idx) => {
            const itemKey = `faq-${idx}`;
            const questionTitle = faq.question.trim() || 'Untitled Question';

            return (
              <AccordionItem key={idx} value={itemKey} className="border-b-0 px-4">
                <div className="flex items-center justify-between gap-2">
                  <AccordionTrigger className="hover:no-underline py-4 flex-1 min-w-0 pr-2">
                    <div className="flex items-center gap-2.5 min-w-0 text-left">
                      <Badge
                        variant="secondary"
                        className="text-[10px] font-mono px-1.5 py-0 h-4.5 shrink-0 uppercase"
                      >
                        Q{idx + 1}
                      </Badge>
                      <span className="text-sm font-medium text-foreground truncate">
                        {questionTitle}
                      </span>
                    </div>
                  </AccordionTrigger>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFaqToDelete(idx);
                    }}
                    className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0 cursor-pointer"
                    title={`Delete FAQ #${idx + 1}`}
                    aria-label={`Delete FAQ #${idx + 1}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <AccordionContent className="pt-2 pb-5 space-y-4">
                  {/* Question input */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor={`faq-q-${idx}`}
                        className="text-xs font-medium text-foreground"
                      >
                        Question
                      </label>
                      <span className="text-[11px] text-muted-foreground font-mono">
                        {(faq.question || '').length}/120
                      </span>
                    </div>
                    <Input
                      id={`faq-q-${idx}`}
                      type="text"
                      value={faq.question ?? ''}
                      onChange={(e) => handleUpdate(idx, 'question', e.target.value)}
                      maxLength={120}
                      placeholder="e.g. Do you offer 24/7 emergency service?"
                      className="text-sm h-9 bg-muted/20"
                    />
                  </div>

                  {/* Answer textarea */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor={`faq-a-${idx}`}
                        className="text-xs font-medium text-foreground"
                      >
                        Answer
                      </label>
                      <span className="text-[11px] text-muted-foreground font-mono">
                        {(faq.answer || '').length}/250
                      </span>
                    </div>
                    <Textarea
                      id={`faq-a-${idx}`}
                      value={faq.answer ?? ''}
                      onChange={(e) => handleUpdate(idx, 'answer', e.target.value)}
                      maxLength={250}
                      rows={2}
                      placeholder="e.g. Yes, our technicians are on call 24 hours a day for urgent repairs."
                      className="text-sm bg-muted/20 resize-none leading-relaxed"
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      ) : (
        <div className="text-center py-8 border border-dashed border-border rounded-xl bg-muted/20 space-y-2">
          <HelpCircle className="h-7 w-7 text-muted-foreground/60 mx-auto" />
          <p className="text-xs font-medium text-muted-foreground">
            No FAQs defined yet. Add question &amp; answer pairs callers commonly ask.
          </p>
        </div>
      )}

      {/* Add FAQ Button */}
      {faqs.length < maxFaqs && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAddFaq}
          className="text-xs font-semibold gap-1.5 h-8"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Add question</span>
        </Button>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={faqToDelete !== null} onOpenChange={(open) => !open && setFaqToDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground">
              Delete FAQ #{faqToDelete !== null ? faqToDelete + 1 : ''}?
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground leading-relaxed pt-1">
              Are you sure you want to remove &quot;
              <strong className="text-foreground">
                {faqToDelete !== null ? faqs[faqToDelete]?.question || 'this question' : ''}
              </strong>
              &quot;? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setFaqToDelete(null)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleConfirmDelete}
              className="text-xs font-semibold"
            >
              Delete FAQ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
