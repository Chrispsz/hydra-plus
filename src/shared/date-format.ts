import { format } from "date-fns";
import { enUS, ptBR } from "date-fns/locale";

export const getDateLocale = (language: string) => {
  if (language.startsWith("pt")) return ptBR;

  return enUS;
};

export const formatDate = (
  date: number | Date | string,
  language: string
): string => {
  if (isNaN(new Date(date).getDate())) return "N/A";
  return format(date, language == "en" ? "MM-dd-yyyy" : "dd/MM/yyyy");
};
