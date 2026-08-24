"""Independent validation of the Daisyworld equations used by index.html."""
from math import pow

SIGMA = 5.670374419e-8
P = dict(solar=917.0, death=.3, q=20.0, fertile=1.0, Ag=.5, Ab=.25, Aw=.75)

def growth(t):
    return max(0.0, 1.0 - .003265 * (22.5 - t) ** 2)

def snap(b, w, L):
    g=max(0,1-b-w); x=max(0,P['fertile']-b-w)
    A=g*P['Ag']+b*P['Ab']+w*P['Aw']
    Te=pow(P['solar']*L*(1-A)/SIGMA,.25)-273
    Tb=Te+P['q']*(A-P['Ab']); Tw=Te+P['q']*(A-P['Aw'])
    return x,A,Te,Tb,Tw

def equilibrium(L):
    b=w=.01; dt=.02
    for _ in range(40000):
        x,A,Te,Tb,Tw=snap(b,w,L)
        b=max(1e-9,b+dt*b*(x*growth(Tb)-P['death']))
        w=max(1e-9,w+dt*w*(x*growth(Tw)-P['death']))
        total=b+w
        if total>P['fertile']: b*=P['fertile']/total; w*=P['fertile']/total
    x,A,Te,Tb,Tw=snap(b,w,L)
    sterile=pow(P['solar']*L*(1-P['Ag'])/SIGMA,.25)-273
    return b,w,A,Te,sterile

print(' L    black  white  albedo  living°C  sterile°C')
for L in (.70,.85,1.00,1.15,1.30,1.45):
    b,w,A,t,s=equilibrium(L)
    print(f'{L:>4.2f}  {b:>5.2f}  {w:>5.2f}   {A:>5.2f}    {t:>6.1f}     {s:>6.1f}')
