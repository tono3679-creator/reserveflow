"use client";
import { Toaster as Sonner, type ToasterProps } from "sonner";

function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="top-center"
      richColors
      closeButton
      toastOptions={{ classNames: { toast: "font-sans" } }}
      {...props}
    />
  );
}

export { Toaster };
