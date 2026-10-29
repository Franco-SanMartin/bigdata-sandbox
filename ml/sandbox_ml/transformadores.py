"""Los dos pasos de preprocesamiento que scikit-learn no trae hechos.

Van dentro del Pipeline, así que aprenden SOLO con las filas de entrenamiento
(en la validación cruzada, con las de cada partición) y quedan guardados con
el modelo: al predecir se aplican igual. El código que genera el estudio los
importa de acá; si corre fuera del sandbox, trae una copia de estas clases.
"""
import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.utils.validation import check_is_fitted


class RecortarExtremos(TransformerMixin, BaseEstimator):
    """Lleva al borde los valores extremos de cada columna (winsorizar).

    metodo="iqr": bordes Q1 - factor·IQR y Q3 + factor·IQR (factor 1,5 es la regla de Tukey).
    metodo="pct": bordes en los percentiles 1 y 99.
    """

    def __init__(self, metodo="iqr", factor=1.5):
        self.metodo = metodo
        self.factor = factor

    def fit(self, X, y=None):
        X = np.asarray(X, dtype=float)
        if self.metodo == "pct":
            self.bajo_, self.alto_ = np.nanpercentile(X, 1, axis=0), np.nanpercentile(X, 99, axis=0)
        else:
            q1, q3 = np.nanpercentile(X, 25, axis=0), np.nanpercentile(X, 75, axis=0)
            iqr = q3 - q1
            self.bajo_, self.alto_ = q1 - self.factor * iqr, q3 + self.factor * iqr
        self.n_features_in_ = X.shape[1]
        return self

    def transform(self, X):
        check_is_fitted(self, "bajo_")
        return np.clip(np.asarray(X, dtype=float), self.bajo_, self.alto_)

    def get_feature_names_out(self, input_features=None):
        if input_features is None:
            return np.array([f"x{i}" for i in range(self.n_features_in_)], dtype=object)
        return np.asarray(input_features, dtype=object)


class PartesDeFecha(TransformerMixin, BaseEstimator):
    """Cada columna de fecha pasa a cinco números: año, mes, día, día de la semana (0 = lunes) y hora."""

    PARTES = ("anio", "mes", "dia", "dia_semana", "hora")

    def fit(self, X, y=None):
        X = pd.DataFrame(X)
        self.columnas_ = [str(c) for c in X.columns]
        self.n_features_in_ = X.shape[1]
        return self

    def transform(self, X):
        check_is_fitted(self, "columnas_")
        X = pd.DataFrame(X)
        partes = []
        for c in X.columns:
            f = pd.to_datetime(X[c], errors="coerce")
            partes += [f.dt.year, f.dt.month, f.dt.day, f.dt.dayofweek, f.dt.hour]
        return np.column_stack([p.to_numpy(dtype=float, na_value=np.nan) for p in partes]) if partes \
            else np.empty((len(X), 0))

    def get_feature_names_out(self, input_features=None):
        cols = self.columnas_ if input_features is None else [str(c) for c in input_features]
        return np.array([f"{c}_{p}" for c in cols for p in self.PARTES], dtype=object)
