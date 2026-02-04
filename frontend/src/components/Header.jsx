const Header = () => {
  return (
    <div className="w-full border-b border-slate-200 dark:border-[#233648] bg-white dark:bg-[#111a22]">
      <div className="max-w-[960px] mx-auto px-4 sm:px-10 py-3">
        <header className="flex items-center justify-between whitespace-nowrap">
          <div className="flex items-center gap-4">
            <div className="size-8 flex items-center justify-center rounded bg-primary/10 text-primary">
              <span className="material-symbols-outlined text-2xl">description</span>
            </div>
            <h2 className="text-lg font-bold leading-tight tracking-[-0.015em]">PDF to MD</h2>
          </div>
          <button className="flex min-w-[84px] cursor-pointer items-center justify-center overflow-hidden rounded-lg h-9 px-4 bg-transparent border border-slate-200 dark:border-[#2a3c50] hover:bg-slate-100 dark:hover:bg-[#1c2a38] text-sm font-bold leading-normal tracking-[0.015em] transition-colors">
            <span className="truncate">About</span>
          </button>
        </header>
      </div>
    </div>
  );
};

export default Header;
